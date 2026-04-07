const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const dbConfig = {
    user: 'bcc_user', 
    password: 'BccPass123!',
    server: '127.0.0.1', 
    database: 'BCC_KPI_Web_DB', 
    port: 1433, //
    options: { encrypt: false, trustServerCertificate: true }
};

// Получение статистики с мощными фильтрами (год, месяц, квартал)
app.get('/api/stats', async (req, res) => {
    const { year, month, quarter } = req.query;
    try {
        let pool = await sql.connect(dbConfig);
        let query = `
            SELECT u.UnitName, 
            ISNULL((SELECT SUM(TargetValue) FROM KPI_Targets WHERE UnitId = u.Id 
                ${year ? 'AND Year = @y' : ''} ${month ? 'AND Month = @m' : ''} 
                ${quarter ? 'AND Month IN (' + (quarter == 1 ? '1,2,3' : quarter == 2 ? '4,5,6' : quarter == 3 ? '7,8,9' : '10,11,12') + ')' : ''}), 0) as TargetValue,
            ISNULL((SELECT SUM(ActualValue) FROM KPI_Actuals WHERE UnitId = u.Id 
                ${year ? 'AND Year = @y' : ''} ${month ? 'AND Month = @m' : ''}
                ${quarter ? 'AND Month IN (' + (quarter == 1 ? '1,2,3' : quarter == 2 ? '4,5,6' : quarter == 3 ? '7,8,9' : '10,11,12') + ')' : ''}), 0) as ActualValue
            FROM Units u`;

        let request = pool.request();
        if (year) request.input('y', sql.Int, year);
        if (month) request.input('m', sql.Int, month);
        
        let result = await request.query(query);
        res.json(result.recordset);
    } catch (err) { res.status(500).send(err.message); }
});

// Установка плана (для Главного менеджера)
app.post('/api/save-target', async (req, res) => {
    const { unitId, val, year, month, userId } = req.body;
    try {
        let pool = await sql.connect(dbConfig);
        await pool.request()
            .input('uid', sql.Int, unitId)
            .input('val', sql.Decimal(18,2), val)
            .input('y', sql.Int, year)
            .input('m', sql.Int, month)
            .input('u', sql.Int, userId)
            .query(`IF EXISTS (SELECT 1 FROM KPI_Targets WHERE UnitId=@uid AND Year=@y AND Month=@m)
                    UPDATE KPI_Targets SET TargetValue=@val WHERE UnitId=@uid AND Year=@y AND Month=@m
                    ELSE INSERT INTO KPI_Targets (UnitId, TargetValue, Year, Month, CreatedBy) VALUES (@uid, @val, @y, @m, @u)`);
        res.json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`Попытка входа: ${username}`); // Увидим в терминале
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request()
            .input('u', sql.NVarChar, username)
            .input('p', sql.NVarChar, password)
            .query('SELECT Id, FullName, Role, UnitId FROM Users WHERE Username = @u AND PasswordHash = @p');

        console.log("Результат из БД:", result.recordset); // Это самое важное!

        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            console.log("Пользователь не найден или пароль не подошел");
            res.status(401).json({ message: "Неверный логин или пароль" });
        }
    } catch (err) { 
        console.error("Ошибка SQL:", err.message); // Увидим, если база отвалилась
        res.status(500).send(err.message); 
    }
});

// Сохранение факта
app.post('/api/save-actual', async (req, res) => {
    const { unitId, val, userId } = req.body;
    const now = new Date();
    try {
        let pool = await sql.connect(dbConfig);
        await pool.request()
            .input('uid', sql.Int, unitId)
            .input('val', sql.Decimal(18,2), parseFloat(val))
            .input('y', sql.Int, now.getFullYear())
            .input('m', sql.Int, now.getMonth() + 1)
            .input('u', sql.Int, userId)
            .query(`INSERT INTO KPI_Actuals (UnitId, ActualValue, Year, Month, CreatedBy, CreatedAt) 
                    VALUES (@uid, @val, @y, @m, @u, GETDATE())`);
        res.json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});

app.listen(5000, () => console.log('✅ Бэкенд БЦК пушка-заряжен на 5000'));