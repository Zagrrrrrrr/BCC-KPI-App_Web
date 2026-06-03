const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType } = require('docx');

const app = express();
app.use(express.json());
app.use(cors());

const dbConfig = {
    user: 'bcc_user', 
    password: 'BccPass123!', 
    server: '127.0.0.1',
    database: 'BCC_KPI_Web_DB', 
    port: 1433,
    options: { encrypt: false, trustServerCertificate: true }
};

let pool;
sql.connect(dbConfig).then(p => {
    pool = p;
    console.log("🚀 Успешное подключение к MS SQL Server");
}).catch(err => console.error("❌ Ошибка глобального подключения:", err.message));

const getDateCondition = (year, month, periodType) => {
    let condition = `Year = ${year}`;
    if (periodType === 'month') {
        condition += ` AND Month = ${month}`;
    } else if (periodType === 'quarter') {
        const q = Math.ceil(month / 3);
        condition += ` AND Month BETWEEN ${(q - 1) * 3 + 1} AND ${q * 3}`;
    }
    return condition;
};

// ТУТ ИДУТ ТВОИ СТАРОЙ ЭНДПОИНТЫ (app.get, app.post, которые у тебя уже были)
// ... [ВСТАВЛЯЙ СВОЙ СТАРОЙ КОД ОТСЮДА] ...

// --- АВТОРИЗАЦИЯ ---
// --- АВТОРИЗАЦИЯ (ИСПРАВЛЕНА ПОД ХЕШИРОВАНИЕ) ---
// --- ГИБРИДНАЯ АВТОРИЗАЦИЯ (ДЛЯ СТАРЫХ ТЕКСТОВЫХ И НОВЫХ ХЕШИРОВАННЫХ ПАРОЛЕЙ) ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // 1. Ищем пользователя по Username
        let result = await pool.request()
            .input('u', sql.NVarChar, username)
            .query(`SELECT u.Id, u.FullName, u.Role, u.UnitId, u.PasswordHash, un.UnitName
                    FROM Users u LEFT JOIN Units un ON u.UnitId = un.Id
                    WHERE u.Username = @u`);

        if (result.recordset.length > 0) {
            const user = result.recordset[0];
            const storedPassword = user.PasswordHash;

            let isMatch = false;

            // 2. Проверяем, захеширован ли пароль в БД с помощью bcrypt (строка начинается с $2b$)
            if (storedPassword && storedPassword.startsWith('$2b$')) {
                isMatch = await bcrypt.compare(password, storedPassword);
            } else {
                // Если в БД обычный текст (для старых записей вроде director123)
                isMatch = (password === storedPassword);
            }

            if (isMatch) {
                // Удаляем конфиденциальные данные перед отправкой на фронт
                delete user.PasswordHash;
                return res.json(user);
            } else {
                return res.status(401).json({ message: "Неверный пароль!" });
            }
        } else {
            return res.status(401).json({ message: "Пользователь не найден!" });
        }
    } catch (err) { 
        console.error("Ошибка при авторизации:", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

// --- СПРАВОЧНИКИ ---
app.get('/api/products', async (req, res) => {
    try {
        res.json((await pool.request().query("SELECT * FROM Products")).recordset);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/units', async (req, res) => {
    try {
        res.json((await pool.request().query("SELECT * FROM Units")).recordset);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/units/:id/products', async (req, res) => {
    try {
        let result = await pool.request()
            .input('uid', sql.Int, req.params.id)
            .query(`SELECT p.Id FROM Products p 
                    JOIN UnitProducts up ON p.Id = up.ProductId 
                    WHERE up.UnitId = @uid`);
        res.json(result.recordset);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/admin/unit-products', async (req, res) => {
    const { unitId, productIds } = req.body;
    try {
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        const request = new sql.Request(transaction);
        await request.input('uid', sql.Int, unitId).query("DELETE FROM UnitProducts WHERE UnitId = @uid");
        
        for (let pId of productIds) {
            await new sql.Request(transaction)
                .input('uid', sql.Int, unitId)
                .input('pid', sql.Int, pId)
                .query("INSERT INTO UnitProducts (UnitId, ProductId) VALUES (@uid, @pid)");
        }
        await transaction.commit();
        res.json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});

// --- АДМИНКА (ФИКС ОШИБКИ 500) ---
app.post('/api/admin/:type/save', async (req, res) => {
    const { type } = req.params;
    const data = req.body;
    try {
        let request = pool.request();
        if (type === 'units') {
            request.input('un', sql.NVarChar, data.UnitName).input('unp', sql.NVarChar, data.UNP || null)
                   .input('addr', sql.NVarChar, data.LegalAddress || null).input('dir', sql.NVarChar, data.DirectorName || null)
                   .input('ph', sql.NVarChar, data.PhoneNumber || null).input('ut', sql.NVarChar, data.UnitType || 'Завод');
            
            // Исправленная проверка ID
            if (data.Id && data.Id !== "undefined" && data.Id !== "") {
                request.input('id', sql.Int, data.Id);
                await request.query(`UPDATE Units SET UnitName=@un, UNP=@unp, LegalAddress=@addr, DirectorName=@dir, PhoneNumber=@ph, UnitType=@ut WHERE Id=@id`);
            } else {
                await request.query(`INSERT INTO Units (UnitName, UNP, LegalAddress, DirectorName, PhoneNumber, UnitType) VALUES (@un, @unp, @addr, @dir, @ph, @ut)`);
            }
        } else {
            request.input('pn', sql.NVarChar, data.ProductName).input('um', sql.NVarChar, data.UnitMeasure || 'тн')
                   .input('cat', sql.NVarChar, data.Category || '').input('pid', sql.Int, (data.ParentId && data.ParentId !== "") ? data.ParentId : null);
            
            if (data.Id && data.Id !== "undefined" && data.Id !== "") {
                request.input('id', sql.Int, data.Id);
                await request.query(`UPDATE Products SET ProductName=@pn, UnitMeasure=@um, Category=@cat, ParentId=@pid WHERE Id=@id`);
            } else {
                await request.query(`INSERT INTO Products (ProductName, UnitMeasure, Category, ParentId) VALUES (@pn, @um, @cat, @pid)`);
            }
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/:type/:id', async (req, res) => {
    try {
        const table = req.params.type === 'units' ? 'Units' : 'Products';
        await pool.request().input('id', sql.Int, req.params.id).query(`DELETE FROM ${table} WHERE Id=@id`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Ошибка удаления" }); }
});

app.get('/api/reports', async (req, res) => {
    const { type, unitId, year, month, periodType } = req.query;
    const dateCond = getDateCondition(year, month, periodType);
    try {
        let request = pool.request();
        let query = "";

        if (type === 'holding') {
            query = `SELECT u.UnitName, 
                    ISNULL((SELECT SUM(TargetValue) FROM KPI_Targets WHERE UnitId=u.Id AND ${dateCond}), 0) as PlanVal,
                    ISNULL((SELECT SUM(ActualValue) FROM KPI_Actuals WHERE UnitId=u.Id AND ${dateCond}), 0) as FactVal
                    FROM Units u`;
        } else if (type === 'unit') {
            request.input('unitId', sql.Int, unitId);
            query = `SELECT p.ProductName,
                    ISNULL((SELECT SUM(TargetValue) FROM KPI_Targets WHERE ProductId=p.Id AND UnitId=@unitId AND ${dateCond}), 0) as PlanVal,
                    ISNULL((SELECT SUM(ActualValue) FROM KPI_Actuals WHERE ProductId=p.Id AND UnitId=@unitId AND ${dateCond}), 0) as FactVal
                    FROM Products p 
                    JOIN UnitProducts up ON p.Id = up.ProductId
                    WHERE up.UnitId = @unitId`;
        } else {
            query = `SELECT p.ProductName,
                    ISNULL((SELECT SUM(TargetValue) FROM KPI_Targets WHERE ProductId=p.Id AND ${dateCond}), 0) as PlanVal,
                    ISNULL((SELECT SUM(ActualValue) FROM KPI_Actuals WHERE ProductId=p.Id AND ${dateCond}), 0) as FactVal
                    FROM Products p`;
        }
        let result = await request.query(query);
        res.json(result.recordset);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/stats', async (req, res) => {
    const { year, month, periodType } = req.query;
    const dateCond = getDateCondition(year, month, periodType);
    try {
        let result = await pool.request().query(`
            SELECT u.Id as UnitId, u.UnitName,
            ISNULL((SELECT SUM(TargetValue) FROM KPI_Targets WHERE UnitId=u.Id AND ${dateCond}), 0) as TargetValue,
            ISNULL((SELECT SUM(ActualValue) FROM KPI_Actuals WHERE UnitId=u.Id AND ${dateCond}), 0) as ActualValue
            FROM Units u`);
        res.json(result.recordset);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/save', async (req, res) => {
    const { unitId, productId, val, year, month, userId, isTarget } = req.body;
    const table = isTarget ? 'KPI_Targets' : 'KPI_Actuals';
    const col = isTarget ? 'TargetValue' : 'ActualValue';
    try {
        await pool.request()
            .input('uid', sql.Int, unitId).input('pid', sql.Int, productId)
            .input('v', sql.Decimal(18,2), val).input('y', sql.Int, year)
            .input('m', sql.Int, month).input('u', sql.Int, userId)
            .query(`IF EXISTS (SELECT 1 FROM ${table} WHERE UnitId=@uid AND ProductId=@pid AND Year=@y AND Month=@m)
                    UPDATE ${table} SET ${col}=@v WHERE UnitId=@uid AND ProductId=@pid AND Year=@y AND Month=@m
                    ELSE INSERT INTO ${table} (UnitId, ProductId, ${col}, Year, Month, CreatedBy) VALUES (@uid,@pid,@v,@y,@m,@u)`);
        res.json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});

// =========================================================================
// НАЧАЛО НОВОГО ФУНКЦИОНАЛА (КЕРРЕКЦИЯ KPI И СОЗДАНИЕ ЗАВОДА С МЕНЕДЖЕРОМ)
// =========================================================================

// 1. Получение списка планов или фактов для конкретного завода и периода
app.get('/api/admin/kpi-manage/list', async (req, res) => {
    const { unitId, year, month, isTarget } = req.query;
    const table = isTarget === 'true' ? 'KPI_Targets' : 'KPI_Actuals';
    const col = isTarget === 'true' ? 'TargetValue' : 'ActualValue';
    try {
        let result = await pool.request()
            .input('uid', sql.Int, unitId)
            .input('y', sql.Int, year)
            .input('m', sql.Int, month)
            .query(`
                SELECT t.Id, t.UnitId, t.ProductId, t.${col} as Val, t.Year, t.Month, p.ProductName, u.UnitName
                FROM ${table} t
                JOIN Products p ON t.ProductId = p.Id
                JOIN Units u ON t.UnitId = u.Id
                WHERE t.UnitId = @uid AND t.Year = @y AND t.Month = @m
            `);
        res.json(result.recordset);
    } catch (err) { res.status(500).send(err.message); }
});

// 2. Изменение значения конкретной записи KPI по её уникальному Id
app.post('/api/admin/kpi-manage/update', async (req, res) => {
    const { id, val, isTarget } = req.body;
    const table = isTarget ? 'KPI_Targets' : 'KPI_Actuals';
    const col = isTarget ? 'TargetValue' : 'ActualValue';
    try {
        await pool.request()
            .input('id', sql.Int, id)
            .input('v', sql.Decimal(18,2), val)
            .query(`UPDATE ${table} SET ${col} = @v WHERE Id = @id`);
        res.json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});

// 3. Полное удаление записи KPI по её уникальному Id
app.delete('/api/admin/kpi-manage/delete/:isTarget/:id', async (req, res) => {
    const { isTarget, id } = req.params;
    const table = isTarget === 'true' ? 'KPI_Targets' : 'KPI_Actuals';
    try {
        await pool.request()
            .input('id', sql.Int, id)
            .query(`DELETE FROM ${table} WHERE Id = @id`);
        res.json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});

// 4. ИСПРАВЛЕННЫЙ РОУТ: Создание нового предприятия ОДНОВРЕМЕННО с менеджером внутри транзакции
app.post('/api/admin/units-with-manager', async (req, res) => {
    const { UnitName, UNP, LegalAddress, DirectorName, PhoneNumber, UnitType, Username, Password, FullName } = req.body;
    
    // Проверка обязательных параметров формы
    if (!UnitName || !Username || !Password) {
        return res.status(400).json({ error: "Название завода, логин и пароль обязательны для заполнения!" });
    }

    const transaction = new sql.Transaction(pool);
    
    try {
        await transaction.begin();
        
        // Шаг 1: Проверяем, уникален ли Username (чтобы избежать Ошибки 500/нарушения UNIQUE констрейнта)
        const checkUserRequest = new sql.Request(transaction);
        const userCheck = await checkUserRequest
            .input('u', sql.NVarChar, Username)
            .query('SELECT Id FROM Users WHERE Username = @u');

        if (userCheck.recordset.length > 0) {
            await transaction.rollback();
            return res.status(400).json({ error: "Пользователь с таким логином уже зарегистрирован в системе!" });
        }
        
        // Шаг 2: Создаем запись в таблице Units
        const unitRequest = new sql.Request(transaction);
        unitRequest.input('un', sql.NVarChar, UnitName)
                   .input('unp', sql.NVarChar, UNP || null)
                   .input('addr', sql.NVarChar, LegalAddress || null)
                   .input('dir', sql.NVarChar, DirectorName || null)
                   .input('ph', sql.NVarChar, PhoneNumber || null)
                   .input('ut', sql.NVarChar, UnitType || 'Завод');
        
        let unitResult = await unitRequest.query(`
            INSERT INTO Units (UnitName, UNP, LegalAddress, DirectorName, PhoneNumber, UnitType) 
            OUTPUT INSERTED.Id
            VALUES (@un, @unp, @addr, @dir, @ph, @ut)
        `);
        
        const newUnitId = unitResult.recordset[0].Id;
        
        // Шаг 3: Хешируем полученный текстовый пароль через bcrypt
        const hashedPassword = await bcrypt.hash(Password, 10);
        
        // Шаг 4: Создаем пользователя в Users со связью на UnitId и сохраняем хэш пароля в PasswordHash
        const userRequest = new sql.Request(transaction);
        userRequest.input('u', sql.NVarChar, Username)
                   .input('p', sql.NVarChar, hashedPassword) // Сохраняем надежный хэш
                   .input('fn', sql.NVarChar, FullName || DirectorName || 'Менеджер завода')
                   .input('role', sql.NVarChar, 'factory_manager') 
                   .input('uid', sql.Int, newUnitId);
        
        await userRequest.query(`
            INSERT INTO Users (Username, PasswordHash, FullName, Role, UnitId, IsActive)
            VALUES (@u, @p, @fn, @role, @uid, 1)
        `);
        
        // Фиксируем все изменения в базе данных
        await transaction.commit();
        res.json({ success: true, unitId: newUnitId });
        
    } catch (err) {
        // Если произошел сбой — откатываем транзакцию, база остается чистой
        if (transaction._connected) {
            await transaction.rollback();
        }
        console.error("Критическая ошибка транзакции на сервере:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// =========================================================================
// КОНЕЦ НОВОГО ФУНКЦИОНАЛА
// =========================================================================

// =========================================================================
// 📄 ДОБАВЛЕННЫЙ РОУТ ДЛЯ ГЕНЕРАЦИИ ОФИЦИАЛЬНОГО WORD ОТЧЕТА БЦК
// =========================================================================
app.get('/api/reports/word', async (req, res) => {
    const { type, unitId, year, month, periodType } = req.query;
    const dateCond = getDateCondition(year, month, periodType);

    try {
        let titleText = "ОТЧЕТ ПО ВЫПОЛНЕНИЮ KPI";
        let subTitleText = `Период: ${periodType === 'month' ? 'Месяц ' + month : 'Квартал'} ${year} г.`;
        let query = "";
        let request = pool.request();

        // ФОРМИРУЕМ ЗАПРОСЫ
        if (type === 'holding') {
            titleText = "СВОДНЫЙ ОТЧЕТ ПО ВЫПОЛНЕНИЮ KPI ПРЕДПРИЯТИЙ ХОЛДИНГА";
            query = `SELECT u.UnitName AS Name, 'Общие' AS CategoryName, 
                    ISNULL((SELECT SUM(TargetValue) FROM KPI_Targets WHERE UnitId=u.Id AND ${dateCond}), 0) as PlanVal,
                    ISNULL((SELECT SUM(ActualValue) FROM KPI_Actuals WHERE UnitId=u.Id AND ${dateCond}), 0) as FactVal
                    FROM Units u`;
        } else if (type === 'unit') {
            request.input('unitId', sql.Int, unitId);
            let unitNameRes = await pool.request().input('uid', sql.Int, unitId).query("SELECT UnitName FROM Units WHERE Id = @uid");
            let uName = unitNameRes.recordset[0]?.UnitName || "Предприятие";
            titleText = `ОТЧЕТ ПО ВЫПОЛНЕНИЮ KPI ДЛЯ ПРЕДПРИЯТИЯ\n"${uName.toUpperCase()}"`;
            
            query = `SELECT p.ProductName AS Name, p.Category AS CategoryName,
                    (SELECT SUM(TargetValue) FROM KPI_Targets WHERE ProductId=p.Id AND UnitId=@unitId AND ${dateCond}) as PlanVal,
                    (SELECT SUM(ActualValue) FROM KPI_Actuals WHERE ProductId=p.Id AND UnitId=@unitId AND ${dateCond}) as FactVal
                    FROM Products p 
                    JOIN UnitProducts up ON p.Id = up.ProductId
                    WHERE up.UnitId = @unitId 
                    AND p.ParentId IS NOT NULL 
                    AND ( (SELECT SUM(TargetValue) FROM KPI_Targets WHERE ProductId=p.Id AND UnitId=@unitId AND ${dateCond}) > 0 
                          OR (SELECT SUM(ActualValue) FROM KPI_Actuals WHERE ProductId=p.Id AND UnitId=@unitId AND ${dateCond}) > 0 )`;
        } else {
            titleText = "ОТЧЕТ В РАЗРЕЗЕ НОМЕНКЛАТУРЫ ПРОДУКЦИИ ХОЛДИНГА";
            query = `SELECT p.ProductName AS Name, p.Category AS CategoryName,
                    (SELECT SUM(TargetValue) FROM KPI_Targets WHERE ProductId=p.Id AND ${dateCond}) as PlanVal,
                    (SELECT SUM(ActualValue) FROM KPI_Actuals WHERE ProductId=p.Id AND ${dateCond}) as FactVal
                    FROM Products p 
                    WHERE p.ParentId IS NOT NULL
                    AND ( (SELECT SUM(TargetValue) FROM KPI_Targets WHERE ProductId=p.Id AND ${dateCond}) > 0 
                          OR (SELECT SUM(ActualValue) FROM KPI_Actuals WHERE ProductId=p.Id AND ${dateCond}) > 0 )`;
        }

        const dbResult = await request.query(query);
        // Финальная чистка: только непустые имена
        const rawData = dbResult.recordset.filter(row => row.Name && row.Name.trim() !== '');

        // ГРУППИРОВКА
        const groupedData = rawData.reduce((acc, row) => {
            const cat = (row.CategoryName && row.CategoryName.trim() !== '') ? row.CategoryName : "Без категории";
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(row);
            return acc;
        }, {});

        // ФОРМИРОВАНИЕ ДОКУМЕНТА
        const docChildren = [
            new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Республиканское производственно-торговое унитарное предприятие", italics: true, size: 18 })] }),
            new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "«Управляющая компания холдинга «Белорусская цементная компания»", bold: true, italics: true, size: 18 })] }),
            new Paragraph({ text: "", spacing: { after: 500 } }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: titleText, bold: true, size: 26 })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: subTitleText, size: 20, color: "444444", italics: true })] })
        ];

        Object.keys(groupedData).forEach(catName => {
            docChildren.push(new Paragraph({ text: catName.toUpperCase(), bold: true, alignment: AlignmentType.CENTER, spacing: { before: 400, after: 200 } }));
            
            const catRows = [
                new TableRow({ children: [
                    new TableCell({ children: [new Paragraph({ text: "Наименование", bold: true })], width: { size: 50, type: WidthType.PERCENTAGE } }),
                    new TableCell({ children: [new Paragraph({ text: "План", bold: true })], width: { size: 15, type: WidthType.PERCENTAGE } }),
                    new TableCell({ children: [new Paragraph({ text: "Факт", bold: true })], width: { size: 15, type: WidthType.PERCENTAGE } }),
                    new TableCell({ children: [new Paragraph({ text: "% Вып.", bold: true })], width: { size: 20, type: WidthType.PERCENTAGE } })
                ]})
            ];

            groupedData[catName].forEach(row => {
                const pVal = parseFloat(row.PlanVal) || 0;
                const fVal = parseFloat(row.FactVal) || 0;
                const pct = pVal > 0 ? ((fVal / pVal) * 100).toFixed(1) + '%' : '0.0%';
                catRows.push(new TableRow({ children: [
                    new TableCell({ children: [new Paragraph(row.Name || '')] }),
                    new TableCell({ children: [new Paragraph(pVal.toLocaleString('ru-RU'))] }),
                    new TableCell({ children: [new Paragraph(fVal.toLocaleString('ru-RU'))] }),
                    new TableCell({ children: [new Paragraph(pct)] })
                ]}));
            });

            docChildren.push(new Table({ rows: catRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        });

        const doc = new Document({ sections: [{ children: docChildren }] });
        const b64string = await Packer.toBase64String(doc);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename=BCC_KPI_Report.docx');
        res.send(Buffer.from(b64string, 'base64'));

    } catch (error) {
        console.error("Ошибка при генерации Word:", error);
        res.status(500).send("Ошибка при генерации документа: " + error.message);
    }
});
// --- НОВЫЙ BI АНАЛИТИЧЕСКИЙ МОДУЛЬ ---
app.get('/api/analytics/dashboard', async (req, res) => {
    const { year, month, periodType } = req.query;
    try {
        if (!pool) throw new Error("База данных не подключена");
        
        const cond = getDateCondition(year, month, periodType);
        const result = await pool.request().query(`
            SELECT u.Id, u.UnitName,
            (SELECT SUM(TargetValue) FROM KPI_Targets WHERE UnitId=u.Id AND ${cond}) as Target,
            (SELECT SUM(ActualValue) FROM KPI_Actuals WHERE UnitId=u.Id AND ${cond}) as Actual
            FROM Units u
        `);
        
        const factories = result.recordset;
        let totalTarget = 0, totalActual = 0;
        
        const analytics = factories.map(f => {
            const plan = f.Target || 0;
            const fact = f.Actual || 0;
            totalTarget += plan; 
            totalActual += fact;
            const pct = plan > 0 ? (fact / plan) * 100 : 0;
            return { ...f, pct };
        });

     res.json({
            summary: { totalTarget, totalActual },
            topBest: [...analytics].sort((a, b) => b.pct - a.pct).slice(0, 3),
           topWorst: [...analytics]
    .filter(f => f.Target > 0 && f.pct < 80) // Оставляем только "проблемных"
    .sort((a, b) => a.pct - b.pct) 
    .slice(0, 3) // Из них берем 3 самых худших
        
        });
    } catch (err) { 
        console.error("Ошибка в BI модуле:", err);
        res.status(500).json({ error: err.message }); 
    }
});

app.listen(5000, () => console.log("✅ Сервер запущен на порту 3001"));

