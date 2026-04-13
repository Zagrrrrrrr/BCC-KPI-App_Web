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
    let result = await pool.request().query("SELECT * FROM Products");
    res.json(result.recordset);
});

app.get('/api/units', async (req, res) => {
    let pool = await sql.connect(dbConfig);
    let result = await pool.request().query("SELECT * FROM Units");
    res.json(result.recordset);
});

// --- УПРАВЛЕНИЕ (АДМИНКА) ---
app.post('/api/admin/units/save', async (req, res) => {
    const { Id, UnitName, FullName_Official, UNP, LegalAddress, DirectorName, PhoneNumber } = req.body;
    let pool = await sql.connect(dbConfig);
    const reqSql = pool.request()
        .input('un', sql.NVarChar, UnitName).input('fn', sql.NVarChar, FullName_Official)
        .input('unp', sql.NVarChar, UNP).input('addr', sql.NVarChar, LegalAddress)
        .input('dir', sql.NVarChar, DirectorName).input('ph', sql.NVarChar, PhoneNumber);

    if (Id) {
        await reqSql.input('id', sql.Int, Id)
            .query(`UPDATE Units SET UnitName=@un, FullName_Official=@fn, UNP=@unp, 
                    LegalAddress=@addr, DirectorName=@dir, PhoneNumber=@ph WHERE Id=@id`);
    } else {
        await reqSql.query(`INSERT INTO Units (UnitName, FullName_Official, UNP, LegalAddress, DirectorName, PhoneNumber) 
                           VALUES (@un, @fn, @unp, @addr, @dir, @ph)`);
    }
    res.json({ success: true });
});

app.post('/api/admin/products/save', async (req, res) => {
    const { Id, ProductName } = req.body;
    let pool = await sql.connect(dbConfig);
    if (Id) {
        await pool.request().input('id', sql.Int, Id).input('n', sql.NVarChar, ProductName)
            .query("UPDATE Products SET ProductName=@n WHERE Id=@id");
    } else {
        await pool.request().input('n', sql.NVarChar, ProductName)
            .query("INSERT INTO Products (ProductName) VALUES (@n)");
    }
    res.json({ success: true });
});

// --- ДАННЫЕ И ОТЧЕТЫ (KPI) ---
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

app.get('/api/stats', async (req, res) => {
    const { year, month } = req.query;
    let pool = await sql.connect(dbConfig);
    let result = await pool.request().input('y', sql.Int, year).input('m', sql.Int, month)
        .query(`SELECT u.Id as UnitId, u.UnitName, 
                ISNULL((SELECT SUM(TargetValue) FROM KPI_Targets WHERE UnitId=u.Id AND Year=@y AND Month=@m), 0) as TargetValue,
                ISNULL((SELECT SUM(ActualValue) FROM KPI_Actuals WHERE UnitId=u.Id AND Year=@y AND Month=@m), 0) as ActualValue
                FROM Units u`);
    res.json(result.recordset);
});

app.get('/api/reports', async (req, res) => {
    const { type, unitId, year, month } = req.query;
    let pool = await sql.connect(dbConfig);
    let query = "";
    if (type === 'holding') {
        query = `SELECT un.UnitName, SUM(ISNULL(t.TargetValue,0)) as PlanVal, SUM(ISNULL(a.ActualValue,0)) as FactVal,
                 CASE WHEN SUM(ISNULL(a.ActualValue,0)) - SUM(ISNULL(t.TargetValue,0)) > 0 THEN SUM(ISNULL(a.ActualValue,0)) - SUM(ISNULL(t.TargetValue,0)) ELSE 0 END as Plus,
                 CASE WHEN SUM(ISNULL(a.ActualValue,0)) - SUM(ISNULL(t.TargetValue,0)) < 0 THEN ABS(SUM(ISNULL(a.ActualValue,0)) - SUM(ISNULL(t.TargetValue,0))) ELSE 0 END as Minus
                 FROM Units un LEFT JOIN KPI_Targets t ON un.Id=t.UnitId AND t.Year=@y AND t.Month=@m
                 LEFT JOIN KPI_Actuals a ON un.Id=a.UnitId AND a.Year=@y AND a.Month=@m GROUP BY un.UnitName`;
    } else if (type === 'unit') {
        query = `SELECT p.ProductName, SUM(ISNULL(t.TargetValue,0)) as PlanVal, SUM(ISNULL(a.ActualValue,0)) as FactVal,
                 CASE WHEN SUM(ISNULL(a.ActualValue,0)) - SUM(ISNULL(t.TargetValue,0)) > 0 THEN SUM(ISNULL(a.ActualValue,0)) - SUM(ISNULL(t.TargetValue,0)) ELSE 0 END as Plus,
                 CASE WHEN SUM(ISNULL(a.ActualValue,0)) - SUM(ISNULL(t.TargetValue,0)) < 0 THEN ABS(SUM(ISNULL(a.ActualValue,0)) - SUM(ISNULL(t.TargetValue,0))) ELSE 0 END as Minus
                 FROM Products p LEFT JOIN KPI_Targets t ON p.Id=t.ProductId AND t.UnitId=@uid AND t.Year=@y AND t.Month=@m
                 LEFT JOIN KPI_Actuals a ON p.Id=a.ProductId AND a.UnitId=@uid AND a.Year=@y AND a.Month=@m GROUP BY p.ProductName`;
    } else {
        query = `SELECT p.ProductName, un.UnitName, ISNULL(t.TargetValue,0) as PlanVal, ISNULL(a.ActualValue,0) as FactVal
                 FROM Products p CROSS JOIN Units un LEFT JOIN KPI_Targets t ON p.Id=t.ProductId AND un.Id=t.UnitId AND t.Year=@y AND t.Month=@m
                 LEFT JOIN KPI_Actuals a ON p.Id=a.ProductId AND un.Id=a.UnitId AND a.Year=@y AND a.Month=@m ORDER BY FactVal DESC`;
    }
    let r = await pool.request().input('y', sql.Int, year).input('m', sql.Int, month).input('uid', sql.Int, unitId).query(query);
    res.json(r.recordset);
});

app.listen(5000, () => console.log('🚀 BCC Backend is ON'));