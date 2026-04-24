import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BarChart2, PlusCircle, FileText, LogOut, Download, Settings, Trash2, Edit3, Building2, Package } from 'lucide-react';
import * as XLSX from 'xlsx';

const BCC_BLUE = "#0054a6";
const BCC_YELLOW = "#ffcb05";
const BYN = "Б̶";

const formatBYN = (val) => new Intl.NumberFormat('ru-RU').format(val || 0) + ` ${BYN}`;

const App = () => {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user')));
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState([]);
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState([]);
  const [filters, setFilters] = useState({ year: 2026, month: 4, periodType: 'month' });

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const q = `year=${filters.year}&month=${filters.month}&periodType=${filters.periodType}`;
      const [s, p, u] = await Promise.all([
        axios.get(`http://localhost:5000/api/stats?${q}`),
        axios.get(`http://localhost:5000/api/products`),
        axios.get(`http://localhost:5000/api/units`)
      ]);
      setStats(s.data); setProducts(p.data); setUnits(u.data);
    } catch (err) { console.error("Ошибка загрузки:", err); }
  }, [filters, user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totals = useMemo(() => stats.reduce((acc, curr) => ({
    t: acc.t + curr.TargetValue, a: acc.a + curr.ActualValue
  }), { t: 0, a: 0 }), [stats]);

  if (!user) return <LoginScreen setUser={setUser} />;

  return (
    <div style={styles.container}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>БЦК <span>KPI WEB</span></div>
        <nav style={styles.nav}>
          <NavItem icon={<BarChart2/>} label="Дашборд" active={activeTab==='dashboard'} onClick={()=>setActiveTab('dashboard')} />
          {user.Role !== 'Director' && <NavItem icon={<PlusCircle/>} label="Ввод данных" active={activeTab==='entry'} onClick={()=>setActiveTab('entry')} />}
          {user.Role === 'HeadManager' && <NavItem icon={<Settings/>} label="Управление" active={activeTab==='admin'} onClick={()=>setActiveTab('admin')} />}
          <NavItem icon={<FileText/>} label="Отчеты" active={activeTab==='reports'} onClick={()=>setActiveTab('reports')} />
        </nav>
        <div style={styles.userCard}>
          <b>{user.FullName}</b><br/><small>{user.UnitName || 'Холдинг'}</small>
          <button onClick={()=>{localStorage.clear(); window.location.reload();}} style={styles.logoutBtn}><LogOut size={14}/> Выход</button>
        </div>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
            <div style={styles.filterBar}>
                <select value={filters.periodType} onChange={e=>setFilters({...filters, periodType: e.target.value})} style={styles.select}>
                    <option value="month">Месяц</option><option value="quarter">Квартал</option><option value="year">Весь год</option>
                </select>
                {filters.periodType !== 'year' && (
                    <select value={filters.month} onChange={e=>setFilters({...filters, month: parseInt(e.target.value)})} style={styles.select}>
                        {filters.periodType === 'month' 
                            ? ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"].map((m,i)=><option key={i} value={i+1}>{m}</option>)
                            : ["I Кв","II Кв","III Кв","IV Кв"].map((q,i)=><option key={i} value={(i+1)*3}>{q}</option>)
                        }
                    </select>
                )}
                <select value={filters.year} onChange={e=>setFilters({...filters, year: parseInt(e.target.value)})} style={styles.select}>
                    <option value={2025}>2025 г.</option><option value={2026}>2026 г.</option>
                </select>
            </div>
        </header>

        {activeTab === 'dashboard' && (
            <div style={styles.content}>
                <div style={styles.statsRow}>
                    <div style={styles.statCard}>План: <b>{formatBYN(totals.t)}</b></div>
                    <div style={styles.statCard}>Факт: <b>{formatBYN(totals.a)}</b></div>
                    <div style={{...styles.statCard, color: totals.a >= totals.t ? 'green' : 'red'}}>
                        Выполнение: <b>{totals.t > 0 ? ((totals.a/totals.t)*100).toFixed(1) : 0}%</b>
                    </div>
                </div>
                <div style={styles.card}>
                    <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={stats}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="UnitName"/><YAxis/><Tooltip formatter={v=>formatBYN(v)}/><Legend/>
                            <Bar dataKey="TargetValue" fill={BCC_BLUE} name="План"/><Bar dataKey="ActualValue" fill={BCC_YELLOW} name="Факт"/>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        )}

        {activeTab === 'admin' && <AdminSection units={units} products={products} refresh={fetchData} />}
        {activeTab === 'entry' && <EntrySection user={user} products={products} units={units} refresh={fetchData} filters={filters} />}
        {activeTab === 'reports' && <ReportsSection units={units} filters={filters} />}
      </main>
    </div>
  );
};

// --- ОТЧЕТЫ (ВЕРНУЛ С ИТОГАМИ) ---
const ReportsSection = ({ units, filters }) => {
  const [repType, setRepType] = useState('holding');
  const [data, setData] = useState([]);
  const [selUnit, setSelUnit] = useState(1);

  const load = async () => {
    const res = await axios.get(`http://localhost:5000/api/reports?type=${repType}&unitId=${selUnit}&year=${filters.year}&month=${filters.month}&periodType=${filters.periodType}`);
    setData(res.data);
  };

  const repTotals = useMemo(() => data.reduce((acc, c) => ({
    p: acc.p + (c.PlanVal || 0), f: acc.f + (c.FactVal || 0)
  }), { p: 0, f: 0 }), [data]);

  const exportExcel = () => {
    const header = [["ОАО «БЕЛОРУССКАЯ ЦЕМЕНТНАЯ КОМПАНИЯ»"], ["ОТЧЕТ ЗА ПЕРИОД: " + filters.month + "/" + filters.year], [], ["Наименование", "План", "Факт", "Отклонение"]];
    const rows = data.map(r => [r.UnitName || r.ProductName, r.PlanVal, r.FactVal, r.FactVal - r.PlanVal]);
    rows.push(["ИТОГО", repTotals.p, repTotals.f, repTotals.f - repTotals.p]);
    const ws = XLSX.utils.aoa_to_sheet([...header, ...rows]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `BCC_Report.xlsx`);
  };

  return (
    <div style={styles.content}>
      <div style={styles.card}>
        <div style={styles.reportTabs}>
          {['holding', 'unit', 'products'].map(t => <button key={t} onClick={() => setRepType(t)} style={repType === t ? styles.tabActive : styles.tab}>
            {t === 'holding' ? 'По холдингу' : t === 'unit' ? 'По заводу' : 'По продукции'}
          </button>)}
        </div>
        <div style={{display: 'flex', gap: '15px', marginBottom: '20px'}}>
          {repType === 'unit' && <select style={styles.select} value={selUnit} onChange={e => setSelUnit(e.target.value)}>{units.map(u => <option key={u.Id} value={u.Id}>{u.UnitName}</option>)}</select>}
          <button onClick={load} style={styles.accentBtn}>Сформировать</button>
          <button onClick={exportExcel} style={styles.excelBtn}><Download size={16}/> Скачать Excel</button>
        </div>
        <table style={styles.adminTable}>
          <thead><tr><th>Наименование</th><th>План</th><th>Факт</th><th>Разница</th></tr></thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i}><td>{r.UnitName || r.ProductName}</td><td>{formatBYN(r.PlanVal)}</td><td>{formatBYN(r.FactVal)}</td>
                <td style={{color: r.FactVal >= r.PlanVal ? 'green' : 'red'}}>{formatBYN(r.FactVal - r.PlanVal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot style={{background: '#f9f9f9', fontWeight: 'bold'}}>
            <tr><td>ИТОГО ПО ХОЛДИНГУ:</td><td>{formatBYN(repTotals.p)}</td><td>{formatBYN(repTotals.f)}</td><td>{formatBYN(repTotals.f - repTotals.p)}</td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

// --- АДМИНКА (ВСЕ КОЛОНКИ НА МЕСТЕ) ---
const AdminSection = ({ units, products, refresh }) => {
  const [tab, setTab] = useState('units');
  const [editItem, setEditItem] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    await axios.post(`http://localhost:5000/api/admin/${tab}/save`, data);
    setEditItem(null); refresh();
  };

  return (
    <div style={styles.content}>
        <div style={styles.card}>
            <div style={styles.reportTabs}>
                <button onClick={()=>setTab('units')} style={tab==='units'?styles.tabActive:styles.tab}>Предприятия</button>
                <button onClick={()=>setTab('products')} style={tab==='products'?styles.tabActive:styles.tab}>Номенклатура</button>
            </div>
            <button onClick={()=>setEditItem({})} style={{...styles.accentBtn, marginBottom:'15px'}}>+ Добавить запись</button>
            <table style={styles.adminTable}>
                <thead>
                    {tab==='units' ? (
                        <tr><th>Название</th><th>УНП</th><th>Юр. Адрес</th><th>Директор</th><th>Телефон</th><th>Действия</th></tr>
                    ) : (
                        <tr><th>Продукт</th><th>Ед. изм.</th><th>Категория</th><th>Действия</th></tr>
                    )}
                </thead>
                <tbody>
                    {(tab==='units'?units:products).map(item => (
                        <tr key={item.Id}>
                            <td><b>{item.UnitName || item.ProductName}</b></td>
                            {tab==='units' ? (
                                <><td>{item.UNP}</td><td>{item.LegalAddress}</td><td>{item.DirectorName}</td><td>{item.PhoneNumber}</td></>
                            ) : (
                                <><td>{item.UnitMeasure || 'тн'}</td><td>{item.Category || 'Основное'}</td></>
                            )}
                            <td>
                                <button onClick={()=>setEditItem(item)} style={styles.iconBtn}><Edit3 size={16}/></button>
                                <button onClick={async()=>{if(window.confirm("Удалить?")){await axios.delete(`http://localhost:5000/api/admin/${tab}/${item.Id}`);refresh();}}} style={{...styles.iconBtn, color:'red'}}><Trash2 size={16}/></button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        {editItem && (
            <div style={styles.modal}>
                <form onSubmit={save} style={styles.modalContent}>
                    <h3>{editItem.Id ? 'Редактирование' : 'Новое'}</h3>
                    <input type="hidden" name="Id" defaultValue={editItem.Id} />
                    <div style={styles.formGrid}>
                        {tab==='units' ? (
                            <>
                                <div style={styles.inputBox}><label>Название</label><input name="UnitName" defaultValue={editItem.UnitName} required/></div>
                                <div style={styles.inputBox}><label>УНП</label><input name="UNP" defaultValue={editItem.UNP} /></div>
                                <div style={{...styles.inputBox, gridColumn:'1/3'}}><label>Юр. Адрес</label><input name="LegalAddress" defaultValue={editItem.LegalAddress} /></div>
                                <div style={styles.inputBox}><label>Директор</label><input name="DirectorName" defaultValue={editItem.DirectorName} /></div>
                                <div style={styles.inputBox}><label>Телефон</label><input name="PhoneNumber" defaultValue={editItem.PhoneNumber} /></div>
                            </>
                        ) : (
                            <>
                                <div style={{...styles.inputBox, gridColumn:'1/3'}}><label>Название</label><input name="ProductName" defaultValue={editItem.ProductName} required/></div>
                                <div style={styles.inputBox}><label>Ед. изм.</label><input name="UnitMeasure" defaultValue={editItem.UnitMeasure} /></div>
                                <div style={styles.inputBox}><label>Категория</label><input name="Category" defaultValue={editItem.Category} /></div>
                            </>
                        )}
                    </div>
                    <div style={{display:'flex', gap:'10px', marginTop:'20px'}}>
                        <button type="submit" style={styles.submitBtn}>СОХРАНИТЬ</button>
                        <button type="button" onClick={()=>setEditItem(null)} style={styles.cancelBtn}>ОТМЕНА</button>
                    </div>
                </form>
            </div>
        )}
    </div>
  );
};

// --- ВВОД ДАННЫХ ---
// --- ВВОД ДАННЫХ (ОБНОВЛЕННЫЙ ТЕКСТ) ---
const EntrySection = ({ user, products, units, refresh, filters }) => {
    const [form, setForm] = useState({ unitId: user.UnitId || units[0]?.Id, productId: products[0]?.Id, val: '' });
    
    const isHead = user.Role === 'HeadManager';

    const save = async () => {
        if (!form.val) return alert("Введите сумму!");
        await axios.post('http://localhost:5000/api/save', { 
            ...form, 
            year: filters.year, 
            month: filters.month, 
            userId: user.Id, 
            isTarget: isHead 
        });
        setForm({...form, val:''}); 
        refresh(); 
        alert("Сохранено успешно!");
    };

    return (
        <div style={styles.content}>
            <div style={styles.card}>
                <h2>{isHead ? 'Установка плановых показателей' : 'Ввод фактических данных'}</h2>
                <p style={{color: '#666', marginBottom: '20px'}}>
                    Период: <b>{filters.month}/{filters.year}</b>
                </p>
                <div style={styles.formGrid}>
                    <div style={styles.inputBox}>
                        <label>Объект (Предприятие)</label>
                        {isHead ? (
                            <select value={form.unitId} onChange={e=>setForm({...form, unitId:e.target.value})} style={styles.select}>
                                {units.map(u=><option key={u.Id} value={u.Id}>{u.UnitName}</option>)}
                            </select>
                        ) : (
                            <input value={user.UnitName} style={styles.inputDisabled} disabled />
                        )}
                    </div>
                    <div style={styles.inputBox}>
                        <label>Номенклатура продукции</label>
                        <select value={form.productId} onChange={e=>setForm({...form, productId:e.target.value})} style={styles.select}>
                            {products.map(p=><option key={p.Id} value={p.Id}>{p.ProductName}</option>)}
                        </select>
                    </div>
                    <div style={styles.inputBox}>
                        {/* ВОТ ЗДЕСЬ ИЗМЕНИЛ ТЕКСТ ПО ТВОЕМУ ЗАПРОСУ */}
                        <label>{isHead ? "Ввод плановой выручки" : "Выручка фактическая"} ({BYN})</label>
                        <input 
                            type="number" 
                            value={form.val} 
                            onChange={e=>setForm({...form, val:e.target.value})} 
                            placeholder="0.00"
                            style={styles.input}
                        />
                    </div>
                    <div style={{display: 'flex', alignItems: 'flex-end'}}>
                        <button onClick={save} style={styles.submitBtn}>
                            {isHead ? "УТВЕРДИТЬ ПЛАН" : "СОХРАНИТЬ ФАКТ"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const NavItem = ({ icon, label, active, onClick }) => (
    <div onClick={onClick} style={{...styles.navItem, background: active ? 'rgba(255,255,255,0.1)' : 'transparent', borderLeft: active ? `4px solid ${BCC_YELLOW}` : '4px solid transparent'}}>
        {icon} <span>{label}</span>
    </div>
);

const LoginScreen = ({ setUser }) => {
    const login = async (e) => {
        e.preventDefault();
        const res = await axios.post('http://localhost:5000/api/login', { username: e.target.u.value, password: e.target.p.value });
        localStorage.setItem('user', JSON.stringify(res.data)); setUser(res.data);
    };
    return (<div style={styles.loginPage}><form onSubmit={login} style={styles.loginCard}><h1 style={{color: BCC_BLUE}}>БЦК KPI</h1><input name="u" placeholder="Логин" required/><input name="p" type="password" placeholder="Пароль" required/><button type="submit">ВХОД</button></form></div>);
};

const styles = {
  container: { display: 'flex', height: '100vh', background: '#f0f2f5', fontFamily: 'sans-serif' },
  sidebar: { width: '260px', background: BCC_BLUE, color: 'white', display: 'flex', flexDirection: 'column' },
  logo: { padding: '25px', fontSize: '20px', fontWeight: 'bold', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' },
  nav: { flex: 1, paddingTop: '10px' },
  navItem: { display: 'flex', alignItems: 'center', gap: '12px', padding: '15px 25px', cursor: 'pointer', transition: '0.2s' },
  userCard: { padding: '20px', background: 'rgba(0,0,0,0.2)', margin: '10px', borderRadius: '8px' },
  logoutBtn: { background: 'none', border: 'none', color: '#ff8888', cursor: 'pointer', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '5px' },
  main: { flex: 1, overflowY: 'auto' },
  header: { background: 'white', padding: '15px 30px', display: 'flex', justifyContent: 'flex-end', borderBottom: '1px solid #ddd' },
  filterBar: { display: 'flex', gap: '10px' },
  content: { padding: '20px' },
  card: { background: 'white', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' },
  statsRow: { display: 'flex', gap: '20px', marginBottom: '20px' },
  statCard: { flex: 1, background: 'white', padding: '20px', borderRadius: '12px', textAlign: 'center', fontSize: '18px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' },
  adminTable: { width: '100%', borderCollapse: 'collapse', marginTop: '20px', fontSize: '14px' },
  reportTabs: { display: 'flex', gap: '10px', marginBottom: '20px' },
  tab: { flex: 1, padding: '10px', border: '1px solid #ddd', cursor: 'pointer', background: '#f9f9f9' },
  tabActive: { flex: 1, padding: '10px', background: BCC_BLUE, color: 'white', border: 'none', fontWeight: 'bold' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' },
  inputBox: { display: 'flex', flexDirection: 'column', gap: '5px' },
  select: { padding: '8px', borderRadius: '4px', border: '1px solid #ccc' },
  submitBtn: { background: BCC_BLUE, color: 'white', border: 'none', padding: '12px', borderRadius: '6px', cursor: 'pointer' },
  cancelBtn: { background: '#eee', border: 'none', padding: '12px', borderRadius: '6px', cursor: 'pointer', flex: 1 },
  accentBtn: { background: BCC_BLUE, color: 'white', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer' },
  excelBtn: { background: '#217346', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: '5px' },
  modal: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modalContent: { background: 'white', padding: '30px', borderRadius: '12px', width: '550px' },
  loginPage: { height: '100vh', background: BCC_BLUE, display: 'flex', justifyContent: 'center', alignItems: 'center' },
  loginCard: { background: 'white', padding: '40px', borderRadius: '15px', display: 'flex', flexDirection: 'column', gap: '15px', width: '320px', textAlign: 'center' }
};

export default App;