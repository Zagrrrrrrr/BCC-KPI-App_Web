const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const app = express();
app.use(express.json());
app.use(cors());

const dbConfig = {
    user: 'bcc_user', password: 'BccPass123!', server: '127.0.0.1',
    database: 'BCC_KPI_Web_DB', port: 1433,
    options: { encrypt: false, trustServerCertificate: true }
};

// Хелпер для формирования условий даты (Месяц, Квартал, Год)
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

// --- АВТОРИЗАЦИЯ ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request()
            .input('u', sql.NVarChar, username).input('p', sql.NVarChar, password)
            .query(`SELECT u.Id, u.FullName, u.Role, u.UnitId, un.UnitName
                    FROM Users u LEFT JOIN Units un ON u.UnitId = un.Id
                    WHERE u.Username = @u AND u.PasswordHash = @p`);
        if (result.recordset.length > 0) res.json(result.recordset[0]);
        else res.status(401).json({ message: "Ошибка входа" });
    } catch (err) { res.status(500).send(err.message); }
});

// --- СПРАВОЧНИКИ ---
app.get('/api/products', async (req, res) => {
    let pool = await sql.connect(dbConfig);
    res.json((await pool.request().query("SELECT * FROM Products")).recordset);
});

app.get('/api/units', async (req, res) => {
    let pool = await sql.connect(dbConfig);
    res.json((await pool.request().query("SELECT * FROM Units")).recordset);
});

// --- АДМИНКА: CRUD ---
app.post('/api/admin/:type/save', async (req, res) => {
    const { type } = req.params;
    const data = req.body;
    let pool = await sql.connect(dbConfig);
    let request = pool.request();

    if (type === 'units') {
        request.input('id', sql.Int, data.Id).input('un', sql.NVarChar, data.UnitName)
               .input('unp', sql.NVarChar, data.UNP).input('addr', sql.NVarChar, data.LegalAddress)
               .input('dir', sql.NVarChar, data.DirectorName).input('ph', sql.NVarChar, data.PhoneNumber);
        
        if (data.Id && data.Id !== "undefined") {
            await request.query(`UPDATE Units SET UnitName=@un, UNP=@unp, LegalAddress=@addr, DirectorName=@dir, PhoneNumber=@ph WHERE Id=@id`);
        } else {
            await request.query(`INSERT INTO Units (UnitName, UNP, LegalAddress, DirectorName, PhoneNumber) VALUES (@un, @unp, @addr, @dir, @ph)`);
        }
    } else {
        request.input('id', sql.Int, data.Id).input('pn', sql.NVarChar, data.ProductName)
               .input('um', sql.NVarChar, data.UnitMeasure).input('cat', sql.NVarChar, data.Category);
        
        if (data.Id && data.Id !== "undefined") {
            await request.query(`UPDATE Products SET ProductName=@pn, UnitMeasure=@um, Category=@cat WHERE Id=@id`);
        } else {
            await request.query(`INSERT INTO Products (ProductName, UnitMeasure, Category) VALUES (@pn, @um, @cat)`);
        }
    }
    res.json({ success: true });
});

app.delete('/api/admin/:type/:id', async (req, res) => {
    let pool = await sql.connect(dbConfig);
    const table = req.params.type === 'units' ? 'Units' : 'Products';
    await pool.request().input('id', sql.Int, req.params.id).query(`DELETE FROM ${table} WHERE Id=@id`);
    res.json({ success: true });
});

// --- ДАННЫЕ И ОТЧЕТЫ ---
app.get('/api/stats', async (req, res) => {
    const { year, month, periodType } = req.query;
    const dateCond = getDateCondition(year, month, periodType);
    let pool = await sql.connect(dbConfig);
    let result = await pool.request().query(`
        SELECT u.Id as UnitId, u.UnitName,
        ISNULL((SELECT SUM(TargetValue) FROM KPI_Targets WHERE UnitId=u.Id AND ${dateCond}), 0) as TargetValue,
        ISNULL((SELECT SUM(ActualValue) FROM KPI_Actuals WHERE UnitId=u.Id AND ${dateCond}), 0) as ActualValue
        FROM Units u`);
    res.json(result.recordset);
});

app.post('/api/save', async (req, res) => {
    const { unitId, productId, val, year, month, userId, isTarget } = req.body;
    const table = isTarget ? 'KPI_Targets' : 'KPI_Actuals';
    const col = isTarget ? 'TargetValue' : 'ActualValue';
    let pool = await sql.connect(dbConfig);
    await pool.request()
        .input('uid', sql.Int, unitId).input('pid', sql.Int, productId)
        .input('v', sql.Decimal(18,2), val).input('y', sql.Int, year)
        .input('m', sql.Int, month).input('u', sql.Int, userId)
        .query(`IF EXISTS (SELECT 1 FROM ${table} WHERE UnitId=@uid AND ProductId=@pid AND Year=@y AND Month=@m)
                UPDATE ${table} SET ${col}=@v WHERE UnitId=@uid AND ProductId=@pid AND Year=@y AND Month=@m
                ELSE INSERT INTO ${table} (UnitId, ProductId, ${col}, Year, Month, CreatedBy) VALUES (@uid,@pid,@v,@y,@m,@u)`);
    res.json({ success: true });
});

app.listen(5000, () => console.log('🚀 BCC Backend Running on 5000'));