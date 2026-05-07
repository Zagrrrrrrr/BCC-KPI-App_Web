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
    port: 1433,
    options: { encrypt: false, trustServerCertificate: true }
};

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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- СПРАВОЧНИКИ ---
app.get('/api/products', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        res.json((await pool.request().query("SELECT * FROM Products")).recordset);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/units', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        res.json((await pool.request().query("SELECT * FROM Units")).recordset);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/units/:id/products', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
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
        let pool = await sql.connect(dbConfig);
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
        let pool = await sql.connect(dbConfig);
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
        let pool = await sql.connect(dbConfig);
        const table = req.params.type === 'units' ? 'Units' : 'Products';
        await pool.request().input('id', sql.Int, req.params.id).query(`DELETE FROM ${table} WHERE Id=@id`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Ошибка удаления" }); }
});

app.get('/api/reports', async (req, res) => {
    const { type, unitId, year, month, periodType } = req.query;
    const dateCond = getDateCondition(year, month, periodType);
    try {
        let pool = await sql.connect(dbConfig);
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
        let pool = await sql.connect(dbConfig);
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
        let pool = await sql.connect(dbConfig);
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

app.listen(5000, () => console.log('🚀 FULL BCC Backend Running on 5000'));