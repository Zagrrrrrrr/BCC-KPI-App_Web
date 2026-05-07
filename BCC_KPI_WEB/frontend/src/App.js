import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BarChart2, PlusCircle, FileText, LogOut, Settings, Trash2, Edit3, Download } from 'lucide-react';

axios.defaults.baseURL = 'http://localhost:5000';

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
        axios.get(`/api/stats?${q}`),
        axios.get(`/api/products`),
        axios.get(`/api/units`)
      ]);
      setStats(s.data); 
      setProducts(p.data); 
      setUnits(u.data);
    } catch (err) { console.error("Ошибка загрузки:", err); }
  }, [filters, user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // СИНХРОНИЗАЦИЯ ПРОФИЛЯ: Если в токене UnitName null, подтягиваем его из списка юнитов
  useEffect(() => {
    if (user && !user.UnitName && units.length > 0) {
      const myUnit = units.find(u => String(u.Id) === String(user.UnitId));
      if (myUnit) {
        const updatedUser = { ...user, UnitName: myUnit.UnitName };
        setUser(updatedUser);
        localStorage.setItem('user', JSON.stringify(updatedUser));
      }
    }
  }, [units, user]);

  const exportToExcel = (data, reportName) => {
    const periodLabel = filters.periodType === 'year' ? `${filters.year} год` : 
                        filters.periodType === 'quarter' ? `${Math.ceil(filters.month/3)} кв. ${filters.year}` : 
                        `${filters.month}.${filters.year}`;
    
    const header = [
      ["ОАО 'БЕЛОРУССКАЯ ЦЕМЕНТНАЯ КОМПАНИЯ'"],
      [`ОТЧЕТ: ${reportName}`],
      [`Период: ${periodLabel}`],
      [""],
      ["Наименование", "План (BYN)", "Факт (BYN)", "Выполнение %"]
    ];

    const rows = data.map(item => [
      item.UnitName || item.ProductName,
      item.PlanVal || item.TargetValue || 0,
      item.FactVal || item.ActualValue || 0,
      item.PlanVal > 0 ? ((item.FactVal / item.PlanVal) * 100).toFixed(1) : "0.0"
    ]);

    const ws = XLSX.utils.aoa_to_sheet([...header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "KPI_Report");
    XLSX.writeFile(wb, `BCC_Report_${reportName}.xlsx`);
  };

  const totals = useMemo(() => stats.reduce((acc, curr) => ({
    t: acc.t + (curr.TargetValue || 0), a: acc.a + (curr.ActualValue || 0)
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
          <b>{user.FullName}</b><br/><small>{user.Role === 'HeadManager' ? 'Ведущий специалист' : (user.UnitName || 'Холдинг')}</small>
          <button onClick={()=>{localStorage.clear(); window.location.reload();}} style={styles.logoutBtn}><LogOut size={14}/> Выход</button>
        </div>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
            <div style={styles.filterBar}>
                <select value={filters.periodType} onChange={e=>setFilters({...filters, periodType: e.target.value})} style={styles.select}>
                    <option value="month">Месяц</option>
                    <option value="quarter">Квартал</option>
                    <option value="year">Весь год</option>
                </select>

                {filters.periodType !== 'year' && (
                    <select value={filters.month} onChange={e=>setFilters({...filters, month: parseInt(e.target.value)})} style={styles.select}>
                        {filters.periodType === 'month' 
                            ? ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"].map((m,i)=><option key={i} value={i+1}>{m}</option>)
                            : ["I Квартал","II Квартал","III Квартал","IV Квартал"].map((q,i)=><option key={i} value={(i+1)*3}>{q}</option>)
                        }
                    </select>
                )}

                <select value={filters.year} onChange={e=>setFilters({...filters, year: parseInt(e.target.value)})} style={styles.select}>
                    <option value={2025}>2025 г.</option>
                    <option value={2026}>2026 г.</option>
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
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'15px'}}>
                        <h3>Выполнение KPI по холдингу</h3>
                        <button onClick={() => exportToExcel(stats, "Дашборд_Холдинг")} style={styles.exportBtn}><Download size={16}/> Excel</button>
                    </div>
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
        {activeTab === 'reports' && <ReportsSection units={units} filters={filters} exportFn={exportToExcel} />}
      </main>
    </div>
  );
};

const EntrySection = ({ user, products, units, refresh, filters }) => {
    const isLead = user.Role === 'HeadManager';
    const [form, setForm] = useState({ unitId: isLead ? '' : user.UnitId, productId: '', val: '' });
    const [selCat, setSelCat] = useState('');
    const [allowedIds, setAllowedIds] = useState([]);
    const [loadingSpec, setLoadingSpec] = useState(false);

    // Умное определение названия завода
    const currentUnitName = useMemo(() => {
        const targetId = isLead ? form.unitId : user.UnitId;
        const found = units.find(u => String(u.Id) === String(targetId));
        return found ? found.UnitName : (targetId ? `Завод ID: ${targetId}` : "Не выбрано");
    }, [units, form.unitId, user.UnitId, isLead]);

    // Загрузка специализации (что разрешено производить этому заводу)
   useEffect(() => {
    const targetUnitId = isLead ? form.unitId : user.UnitId;
    if (!targetUnitId) { 
        console.log("Юнит не выбран, скипаем");
        setAllowedIds([]); 
        return; 
    }

    setLoadingSpec(true);
    axios.get(`/api/units/${targetUnitId}/products`)
        .then(res => {
            console.log("Данные из БД прилетели:", res.data); // ПРОВЕРЬ В КОНСОЛИ (F12)
            // Вытаскиваем ID и превращаем в числа, чтобы сравнение точно сработало
            const ids = res.data.map(item => Number(item.ProductId || item.id || item.Id));
            setAllowedIds(ids);
        })
        .catch(err => {
            console.error("Ошибка запроса специализации:", err);
            setAllowedIds([]);
        })
        .finally(() => setLoadingSpec(false));
}, [form.unitId, user.UnitId, isLead]);

    const categories = useMemo(() => products.filter(p => !p.ParentId), [products]);
    const filteredProducts = useMemo(() => 
        products.filter(p => String(p.ParentId) === String(selCat) && allowedIds.includes(p.Id)), 
    [products, selCat, allowedIds]);

    const save = async () => {
        if (!form.unitId || !form.productId || !form.val) return alert("Заполните все поля!");
        try {
            await axios.post('/api/save', { ...form, ...filters, userId: user.Id, isTarget: isLead });
            setForm(prev => ({...prev, val:''})); 
            refresh(); 
            alert("Данные успешно сохранены!");
        } catch (err) { alert("Ошибка при сохранении!"); }
    };

    return (
        <div style={styles.content}>
            <div style={styles.card}>
               <h2>{isLead ? 'Установка плана' : `Ввод факта: ${currentUnitName}`}</h2>
                <div style={styles.formGrid}>
                    <div style={styles.inputBox}>
                        <label>Предприятие</label>
                        {isLead ? (
                            <select value={form.unitId} onChange={e=>{setForm({...form, unitId:e.target.value, productId:''}); setSelCat('');}} style={styles.select}>
                                <option value="">-- Выберите завод --</option>
                                {units.map(u=><option key={u.Id} value={u.Id}>{u.UnitName}</option>)}
                            </select>
                        ) : <div style={styles.inputDisabled}><b>{currentUnitName}</b></div>}
                    </div>
                    
                    <div style={styles.inputBox}>
                        <label>Категория продукции</label>
                        <select value={selCat} onChange={e=>{setSelCat(e.target.value); setForm({...form, productId:''});}} style={styles.select}>
                            <option value="">-- Выберите категорию --</option>
                            {categories.map(c => <option key={c.Id} value={c.Id}>{c.ProductName}</option>)}
                        </select>
                    </div>

                    <div style={styles.inputBox}>
                        <label>Продукция</label>
                        <select value={form.productId} onChange={e=>setForm({...form, productId:e.target.value})} style={styles.select} disabled={!selCat || allowedIds.length === 0}>
                            <option value="">
                                {loadingSpec ? 'Загрузка...' : !selCat ? '-- Сначала категорию --' : filteredProducts.length > 0 ? '-- Выберите --' : '-- Нет доступа --'}
                            </option>
                            {filteredProducts.map(p=><option key={p.Id} value={p.Id}>{p.ProductName}</option>)}
                        </select>
                        {!loadingSpec && selCat && allowedIds.length === 0 && <small style={{color:'red'}}>⚠️ Не настроена специализация!</small>}
                    </div>

                    <div style={styles.inputBox}>
                        <label>Сумма ({BYN})</label>
                        <input type="number" value={form.val} onChange={e=>setForm({...form, val:e.target.value})} style={styles.input} placeholder="0.00"/>
                    </div>

                    <button onClick={save} style={{...styles.submitBtn, gridColumn: '1 / 3', marginTop: '10px'}}>{isLead ? "УТВЕРДИТЬ ПЛАН" : "СОХРАНИТЬ ДАННЫЕ"}</button>
                </div>
            </div>
        </div>
    );
};

const ReportsSection = ({ units, filters, exportFn }) => {
  const [repType, setRepType] = useState('holding');
  const [data, setData] = useState([]);
  const [selUnit, setSelUnit] = useState('');
  
  useEffect(() => { if(units.length > 0) setSelUnit(units[0].Id); }, [units]);

  const load = async () => {
      const res = await axios.get(`/api/reports?type=${repType}&unitId=${selUnit}&year=${filters.year}&month=${filters.month}&periodType=${filters.periodType}`);
      setData(res.data);
  };
  return (
    <div style={styles.content}>
      <div style={styles.card}>
        <div style={styles.reportTabs}>
          {['holding', 'unit', 'products'].map(t => <button key={t} onClick={() => setRepType(t)} style={repType === t ? styles.tabActive : styles.tab}>{t==='holding'?'Холдинг':t==='unit'?'Завод':'Продукция'}</button>)}
        </div>
        <div style={{display:'flex', gap:'10px', marginBottom:'20px'}}>
            {repType==='unit' && <select style={styles.select} value={selUnit} onChange={e=>setSelUnit(e.target.value)}>{units.map(u=><option key={u.Id} value={u.Id}>{u.UnitName}</option>)}</select>}
            <button onClick={load} style={styles.accentBtn}>Сформировать</button>
            {data.length > 0 && <button onClick={() => exportFn(data, `Отчет_${repType}`)} style={styles.exportBtn}><Download size={16}/> EXCEL</button>}
        </div>
        <table style={styles.adminTable}>
          <thead><tr><th>Наименование</th><th>План</th><th>Факт</th><th>%</th></tr></thead>
          <tbody>{data.map((r,i)=><tr key={i}><td>{r.UnitName || r.ProductName}</td><td>{formatBYN(r.PlanVal)}</td><td>{formatBYN(r.FactVal)}</td><td>{r.PlanVal>0?((r.FactVal/r.PlanVal)*100).toFixed(1):0}%</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
};

const AdminSection = ({ units, products, refresh }) => {
    const [tab, setTab] = useState('units');
    const [editItem, setEditItem] = useState(null);
    const [selUnitProducts, setSelUnitProducts] = useState('');
    const [checkedIds, setCheckedIds] = useState([]);
    const categories = useMemo(() => products.filter(p => !p.ParentId), [products]);
    
    useEffect(() => { if(units.length > 0) setSelUnitProducts(units[0].Id); }, [units]);

    useEffect(() => {
      if (tab === 'assignment' && selUnitProducts) {
          axios.get(`/api/units/${selUnitProducts}/products`).then(res => setCheckedIds(res.data.map(i => i.ProductId || i.Id)));
      }
    }, [tab, selUnitProducts]);
    
    const saveAssignment = async () => {
      await axios.post('/api/admin/unit-products', { unitId: selUnitProducts, productIds: checkedIds });
      alert("Специализация обновлена!");
    };
    
    const save = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      await axios.post(`/api/admin/${tab}/save`, data);
      setEditItem(null); refresh();
    };
    
    return (
      <div style={styles.content}>
          <div style={styles.card}>
              <div style={styles.reportTabs}>
                  <button onClick={()=>setTab('units')} style={tab==='units'?styles.tabActive:styles.tab}>Предприятия</button>
                  <button onClick={()=>setTab('products')} style={tab==='products'?styles.tabActive:styles.tab}>Номенклатура</button>
                  <button onClick={()=>setTab('assignment')} style={tab==='assignment'?styles.tabActive:styles.tab}>Специализация</button>
              </div>
              {tab === 'assignment' ? (
                  <div>
                      <label>Выберите завод: </label>
                      <select value={selUnitProducts} onChange={e=>setSelUnitProducts(e.target.value)} style={{...styles.select, marginBottom:'20px'}}>
                          {units.map(u=><option key={u.Id} value={u.Id}>{u.UnitName}</option>)}
                      </select>
                      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px'}}>
                          {products.filter(p=>p.ParentId).map(p=>(
                              <div key={p.Id} onClick={() => setCheckedIds(prev => prev.includes(p.Id) ? prev.filter(x=>x!==p.Id) : [...prev, p.Id])}
                                   style={{padding:'10px', border:'1px solid #ddd', borderRadius:'4px', cursor:'pointer', background: checkedIds.includes(p.Id) ? '#e3f2fd' : 'white', display:'flex', alignItems:'center', gap:'10px'}}>
                                  <input type="checkbox" checked={checkedIds.includes(p.Id)} readOnly />
                                  <span>{p.ProductName}</span>
                              </div>
                          ))}
                      </div>
                      <button onClick={saveAssignment} style={{...styles.submitBtn, marginTop:'20px'}}>СОХРАНИТЬ СПЕЦИАЛИЗАЦИЮ</button>
                  </div>
              ) : (
                  <>
                      <button onClick={()=>setEditItem({})} style={{...styles.accentBtn, marginBottom:'15px'}}>+ Добавить</button>
                      <table style={styles.adminTable}>
                          <thead>
                              {tab==='units' ? <tr><th>Название</th><th>УНП</th><th>Директор</th><th>Действия</th></tr> : <tr><th>Продукт</th><th>Категория</th><th>Ед. изм.</th><th>Действия</th></tr>}
                          </thead>
                          <tbody>
                              {(tab==='units'?units:products).map(item => (
                                  <tr key={item.Id}>
                                      <td><b>{item.UnitName || item.ProductName}</b></td>
                                      {tab==='units' ? <><td>{item.UNP}</td><td>{item.DirectorName}</td></> : <><td>{item.ParentId ? 'Подкатегория' : 'Главная'}</td><td>{item.UnitMeasure}</td></>}
                                      <td>
                                          <button onClick={()=>setEditItem(item)} style={styles.iconBtn}><Edit3 size={16}/></button>
                                          <button onClick={async()=>{if(window.confirm("Удалить?")){await axios.delete(`/api/admin/${tab}/${item.Id}`);refresh();}}} style={{...styles.iconBtn, color:'red'}}><Trash2 size={16}/></button>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </>
              )}
          </div>
          {editItem && (
              <div style={styles.modal}>
                  <form onSubmit={save} style={styles.modalContent}>
                      <h3>{editItem.Id ? 'Редактирование' : 'Создание'}</h3>
                      <input type="hidden" name="Id" defaultValue={editItem.Id} />
                      <div style={styles.formGrid}>
                          {tab==='units' ? (
                              <>
                                  <div style={styles.inputBox}><label>Название</label><input name="UnitName" defaultValue={editItem.UnitName} required/></div>
                                  <div style={styles.inputBox}><label>УНП</label><input name="UNP" defaultValue={editItem.UNP} /></div>
                                  <div style={styles.inputBox}><label>Директор</label><input name="DirectorName" defaultValue={editItem.DirectorName} /></div>
                                  <div style={styles.inputBox}><label>Тип</label><select name="UnitType" defaultValue={editItem.UnitType} style={styles.select}><option value="Завод">Завод</option><option value="Филиал">Филиал</option></select></div>
                              </>
                          ) : (
                              <>
                                  <div style={{...styles.inputBox, gridColumn:'1/3'}}><label>Название продукции</label><input name="ProductName" defaultValue={editItem.ProductName} required/></div>
                                  <div style={styles.inputBox}><label>Ед. изм.</label><input name="UnitMeasure" defaultValue={editItem.UnitMeasure} /></div>
                                  <div style={styles.inputBox}><label>Родитель</label><select name="ParentId" defaultValue={editItem.ParentId} style={styles.select}><option value="">-- Категория --</option>{categories.map(c => <option key={c.Id} value={c.Id}>{c.ProductName}</option>)}</select></div>
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

const NavItem = ({ icon, label, active, onClick }) => (
    <div onClick={onClick} style={{...styles.navItem, background: active ? 'rgba(255,255,255,0.1)' : 'transparent', borderLeft: active ? `4px solid ${BCC_YELLOW}` : '4px solid transparent'}}>
        {icon} <span>{label}</span>
    </div>
);

const LoginScreen = ({ setUser }) => {
    const login = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post('/api/login', { username: e.target.u.value, password: e.target.p.value });
            localStorage.setItem('user', JSON.stringify(res.data)); setUser(res.data);
        } catch(err) { alert("Неверный логин или пароль!"); }
    };
    return (<div style={styles.loginPage}><form onSubmit={login} style={styles.loginCard}><h1 style={{color: BCC_BLUE, textAlign:'center'}}>БЦК KPI WEB</h1><input name="u" style={styles.input} placeholder="Логин" required/><input name="p" style={styles.input} type="password" placeholder="Пароль" required/><button type="submit" style={styles.submitBtn}>ВХОД В СИСТЕМУ</button></form></div>);
};

const styles = {
  container: { display: 'flex', height: '100vh', background: '#f0f2f5', fontFamily: 'Segoe UI, Tahoma, sans-serif' },
  sidebar: { width: '260px', background: BCC_BLUE, color: 'white', display: 'flex', flexDirection: 'column' },
  logo: { padding: '25px', fontSize: '20px', fontWeight: 'bold', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' },
  nav: { flex: 1, paddingTop: '10px' },
  navItem: { display: 'flex', alignItems: 'center', gap: '12px', padding: '15px 25px', cursor: 'pointer', transition: '0.2s' },
  userCard: { padding: '20px', background: 'rgba(0,0,0,0.2)', margin: '10px', borderRadius: '8px' },
  logoutBtn: { background: 'none', border: 'none', color: '#ff8888', cursor: 'pointer', marginTop: '10px', display:'flex', alignItems:'center', gap:'5px' },
  main: { flex: 1, overflowY: 'auto' },
  header: { background: 'white', padding: '15px 30px', borderBottom: '1px solid #ddd', display:'flex', justifyContent:'flex-end' },
  filterBar: { display:'flex', gap:'10px' },
  content: { padding: '20px' },
  card: { background: 'white', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },
  statsRow: { display: 'flex', gap: '20px', marginBottom: '20px' },
  statCard: { flex: 1, background: 'white', padding: '20px', borderRadius: '12px', textAlign: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },
  adminTable: { width: '100%', borderCollapse: 'collapse', marginTop: '20px', textAlign:'left' },
  reportTabs: { display: 'flex', gap: '10px', marginBottom: '20px' },
  tab: { flex: 1, padding: '12px', cursor: 'pointer', background: '#f9f9f9', border: '1px solid #ddd', borderRadius:'6px' },
  tabActive: { flex: 1, padding: '12px', background: BCC_BLUE, color: 'white', border: 'none', borderRadius:'6px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' },
  inputBox: { display: 'flex', flexDirection: 'column', gap: '8px' },
  input: { padding: '12px', borderRadius: '6px', border: '1px solid #ccc' },
  inputDisabled: { padding: '12px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: '6px' },
  select: { padding: '12px', borderRadius: '6px', border: '1px solid #ccc', background:'white' },
  exportBtn: { display:'flex', alignItems:'center', gap:'8px', background: '#21a366', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '6px', cursor:'pointer' },
  submitBtn: { background: BCC_BLUE, color: 'white', border: 'none', padding: '12px', borderRadius: '6px', cursor: 'pointer', fontWeight:'bold' },
  accentBtn: { background: BCC_BLUE, color: 'white', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer' },
  cancelBtn: { background: '#eee', color: '#333', border: 'none', padding: '12px', borderRadius: '6px', cursor: 'pointer' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', padding:'5px' },
  modal: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContent: { background: 'white', padding: '30px', borderRadius: '15px', width: '550px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' },
  loginPage: { height: '100vh', background: BCC_BLUE, display: 'flex', justifyContent: 'center', alignItems: 'center' },
  loginCard: { background: 'white', padding: '50px', borderRadius: '20px', display: 'flex', flexDirection: 'column', gap: '20px', width: '350px', boxShadow: '0 15px 35px rgba(0,0,0,0.3)' }
};

export default App;