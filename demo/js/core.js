/**
 * DevTracker v0.5.0 — 全量 Demo 核心引擎
 * 路由: #/tasks | #/task/:id | #/stats | #/report | #/personnel | #/fill/:token
 * GAP-01~08 功能完善版
 */

/* ========== 常量 ========== */
const STORAGE_KEYS = { TASKS:'dt_tasks', STAFF:'dt_staff', LINKS:'dt_links', RECORDS:'dt_records', MATCH_GROUPS:'dt_match_groups', REMARKS:'dt_remarks' };
const ROLE_MAP = { frontend:'前端', backend:'后端', test:'测试' };
const ROLE_TAG_MAP = { frontend:'dt-tag-blue', backend:'dt-tag-green', test:'dt-tag-orange' };
const ROLE_COLORS = { frontend:'#165DFF', backend:'#00B42A', test:'#FF7D00' };
const PM_OPTIONS = ['钟冠','吴浩鑫','杨瑞','罗晓璇','其他-昆仑','其他-短信','其他-架构','不在上述'];
const TIME_DIMS = [
  {value:'day',label:'日'},{value:'week',label:'周（默认上周）'},{value:'half_month',label:'半月'},
  {value:'month',label:'月'},{value:'quarter',label:'季度'},{value:'half_year',label:'半年'},{value:'year',label:'年'}
];
const PAGE_SIZE = 20;

/* ========== 工具函数 ========== */
const uid = () => 'xxxx-xxxx'.replace(/x/g,()=>((Math.random()*16)|0).toString(16));
const fmtDate = d => { const t=new Date(d); return `${t.getFullYear()}年${String(t.getMonth()+1).padStart(2,'0')}月${String(t.getDate()).padStart(2,'0')}日`; };
const getQuarter = m => m<=3?'Q1':m<=6?'Q2':m<=9?'Q3':'Q4';
const getWeekNum = d => { const dt=new Date(d),s=new Date(dt.getFullYear(),0,1); return Math.ceil(((dt-s)/86400000+s.getDay()+1)/7); };
const pinyinSort = (a,b) => a.localeCompare(b,'zh-Hans');

/* ========== Store 单例 ========== */
const Store = {
  _g(k,f){ try{ const r=localStorage.getItem(k); return r?JSON.parse(r):f; }catch{return f;} },
  _s(k,v){ localStorage.setItem(k,JSON.stringify(v)); },
  getTasks(){ return this._g(STORAGE_KEYS.TASKS,[]); }, saveTasks(t){ this._s(STORAGE_KEYS.TASKS,t); },
  getStaff(){ return this._g(STORAGE_KEYS.STAFF,[]); }, saveStaff(s){ this._s(STORAGE_KEYS.STAFF,s); },
  getLinks(){ return this._g(STORAGE_KEYS.LINKS,[]); }, saveLinks(l){ this._s(STORAGE_KEYS.LINKS,l); },
  getRecords(){ return this._g(STORAGE_KEYS.RECORDS,[]); }, saveRecords(r){ this._s(STORAGE_KEYS.RECORDS,r); },
  getMatchGroups(){ return this._g(STORAGE_KEYS.MATCH_GROUPS,[]); }, saveMatchGroups(m){ this._s(STORAGE_KEYS.MATCH_GROUPS,m); },
  getRemarks(){ return this._g(STORAGE_KEYS.REMARKS,{}); }, saveRemarks(r){ this._s(STORAGE_KEYS.REMARKS,r); }
};

/* ========== Mock 数据初始化 ========== */
function initMockData(){
  const V='5';
  if(localStorage.getItem('dt_demo_version')===V) return;
  Object.values(STORAGE_KEYS).forEach(k=>localStorage.removeItem(k));
  localStorage.setItem('dt_demo_version',V);

  const staff=[
    {id:'s01',name:'张三',role:'frontend',isActive:true,createdAt:'2026-01-01'},
    {id:'s02',name:'赵六',role:'frontend',isActive:true,createdAt:'2026-01-01'},
    {id:'s03',name:'李四',role:'backend',isActive:true,createdAt:'2026-01-01'},
    {id:'s04',name:'钱七',role:'backend',isActive:true,createdAt:'2026-01-01'},
    {id:'s05',name:'王五',role:'test',isActive:true,createdAt:'2026-01-01'},
    {id:'s06',name:'孙八',role:'test',isActive:true,createdAt:'2026-01-01'}
  ];
  const tasks=[
    {id:'t01',title:'2026年04月06日-2026年04月12日，本年度第15周工作统计',timeDimension:'week',startDate:'2026-04-06',endDate:'2026-04-12',weekNumber:15,year:2026,status:'active',createdAt:'2026-04-12'},
    {id:'t02',title:'2026年03月30日-2026年04月05日，本年度第14周工作统计',timeDimension:'week',startDate:'2026-03-30',endDate:'2026-04-05',weekNumber:14,year:2026,status:'active',createdAt:'2026-04-05'},
    {id:'t03',title:'2026年03月23日-2026年03月29日，本年度第13周工作统计',timeDimension:'week',startDate:'2026-03-23',endDate:'2026-03-29',weekNumber:13,year:2026,status:'closed',createdAt:'2026-03-29'},
    {id:'t04',title:'2026年02月份月度工作统计',timeDimension:'month',startDate:'2026-02-01',endDate:'2026-02-28',weekNumber:0,year:2026,status:'closed',createdAt:'2026-02-28'},
    {id:'t05',title:'2026年01月份月度工作统计',timeDimension:'month',startDate:'2026-01-01',endDate:'2026-01-31',weekNumber:0,year:2026,status:'closed',createdAt:'2026-01-31'}
  ];
  const links=[];
  tasks.forEach(t=>staff.forEach(s=>links.push({id:uid(),taskId:t.id,staffId:s.id,token:uid(),url:`http://localhost:8080/index.html#/fill/${uid()}`,isSubmitted:t.status==='closed',createdAt:t.createdAt})));
  const now='2026-04-12T10:30:00Z';
  const records=[
    {id:'r01',taskId:'t01',staffId:'s01',requirementTitle:'用户中心改版',version:'V4.633.0',productManagers:['杨瑞'],hours:5,createdAt:'2026-04-11T09:00:00Z',updatedAt:'2026-04-12T10:30:00Z'},
    {id:'r02',taskId:'t01',staffId:'s01',requirementTitle:'AI Agent 优化',version:'V4.633.0',productManagers:['钟冠'],hours:3,createdAt:'2026-04-11T09:05:00Z',updatedAt:'2026-04-11T09:05:00Z'},
    {id:'r03',taskId:'t01',staffId:'s02',requirementTitle:'用户中心改版',version:'V4.633.0',productManagers:['杨瑞'],hours:4,createdAt:'2026-04-11T10:00:00Z',updatedAt:'2026-04-11T10:00:00Z'},
    {id:'r04',taskId:'t01',staffId:'s03',requirementTitle:'用户中心改版',version:'V4.633.0',productManagers:['杨瑞'],hours:6,createdAt:'2026-04-11T11:00:00Z',updatedAt:'2026-04-11T11:00:00Z'},
    {id:'r05',taskId:'t01',staffId:'s03',requirementTitle:'AI Agent 优化',version:'V4.633.0',productManagers:['钟冠'],hours:8,createdAt:'2026-04-11T11:05:00Z',updatedAt:'2026-04-11T11:05:00Z'},
    {id:'r06',taskId:'t01',staffId:'s04',requirementTitle:'支付系统升级',version:'V4.634.0',productManagers:['吴浩鑫'],hours:10,createdAt:'2026-04-11T12:00:00Z',updatedAt:'2026-04-11T12:00:00Z'},
    {id:'r07',taskId:'t01',staffId:'s05',requirementTitle:'用户中心改版',version:'V4.633.0',productManagers:['杨瑞'],hours:9,createdAt:'2026-04-11T13:00:00Z',updatedAt:'2026-04-11T13:00:00Z'},
    {id:'r08',taskId:'t01',staffId:'s06',requirementTitle:'AI Agent 优化',version:'V4.633.0',productManagers:['钟冠'],hours:4,createdAt:'2026-04-11T14:00:00Z',updatedAt:'2026-04-11T14:00:00Z'},
    {id:'r09',taskId:'t02',staffId:'s01',requirementTitle:'消息推送重构',version:'V4.632.0',productManagers:['罗晓璇'],hours:7,createdAt:'2026-04-04T09:00:00Z',updatedAt:'2026-04-04T09:00:00Z'},
    {id:'r10',taskId:'t02',staffId:'s03',requirementTitle:'消息推送重构',version:'V4.632.0',productManagers:['罗晓璇'],hours:5,createdAt:'2026-04-04T10:00:00Z',updatedAt:'2026-04-04T10:00:00Z'},
    {id:'r11',taskId:'t02',staffId:'s05',requirementTitle:'消息推送重构',version:'V4.632.0',productManagers:['罗晓璇'],hours:6,createdAt:'2026-04-04T11:00:00Z',updatedAt:'2026-04-04T11:00:00Z'},
    {id:'r12',taskId:'t03',staffId:'s01',requirementTitle:'数据大盘展示',version:'V4.631.0',productManagers:['吴浩鑫'],hours:8,createdAt:'2026-03-28T09:00:00Z',updatedAt:'2026-03-28T09:00:00Z'},
    {id:'r13',taskId:'t03',staffId:'s02',requirementTitle:'数据大盘展示',version:'V4.631.0',productManagers:['吴浩鑫'],hours:6,createdAt:'2026-03-28T10:00:00Z',updatedAt:'2026-03-28T10:00:00Z'},
    {id:'r14',taskId:'t03',staffId:'s03',requirementTitle:'数据大盘展示',version:'V4.631.0',productManagers:['吴浩鑫'],hours:10,createdAt:'2026-03-28T11:00:00Z',updatedAt:'2026-03-28T11:00:00Z'},
    {id:'r15',taskId:'t03',staffId:'s05',requirementTitle:'数据大盘展示',version:'V4.631.0',productManagers:['吴浩鑫'],hours:5,createdAt:'2026-03-28T12:00:00Z',updatedAt:'2026-03-28T12:00:00Z'}
  ];
  const mg=[
    {id:'mg01',taskId:'t01',mergedTitle:'用户中心改版',version:'V4.633.0',productManagers:['杨瑞'],frontend:[{staffName:'张三',hours:5},{staffName:'赵六',hours:4}],backend:[{staffName:'李四',hours:6}],test:[{staffName:'王五',hours:9}],confidence:.92,status:'auto_merged'},
    {id:'mg02',taskId:'t01',mergedTitle:'AI Agent 优化',version:'V4.633.0',productManagers:['钟冠'],frontend:[{staffName:'张三',hours:3}],backend:[{staffName:'李四',hours:8}],test:[{staffName:'孙八',hours:4}],confidence:.85,status:'auto_merged'},
    {id:'mg03',taskId:'t01',mergedTitle:'支付系统升级',version:'V4.634.0',productManagers:['吴浩鑫'],frontend:[],backend:[{staffName:'钱七',hours:10}],test:[],confidence:1,status:'auto_merged'},
    {id:'mg04',taskId:'t02',mergedTitle:'消息推送重构',version:'V4.632.0',productManagers:['罗晓璇'],frontend:[{staffName:'张三',hours:7}],backend:[{staffName:'李四',hours:5}],test:[{staffName:'王五',hours:6}],confidence:.88,status:'auto_merged'},
    {id:'mg05',taskId:'t03',mergedTitle:'数据大盘展示',version:'V4.631.0',productManagers:['吴浩鑫'],frontend:[{staffName:'张三',hours:8},{staffName:'赵六',hours:6}],backend:[{staffName:'李四',hours:10}],test:[{staffName:'王五',hours:5}],confidence:.95,status:'auto_merged'}
  ];
  Store.saveStaff(staff); Store.saveTasks(tasks); Store.saveLinks(links);
  Store.saveRecords(records); Store.saveMatchGroups(mg); Store.saveRemarks({});
}

/* ========== 路由 ========== */
function parseRoute(){
  const h=location.hash.replace('#','')||'/tasks', p=h.split('/').filter(Boolean);
  if(p[0]==='fill'&&p[1]) return {route:'fill',token:p[1]};
  if(p[0]==='task'&&p[1]) return {route:'taskDetail',taskId:p[1]};
  return {route:{tasks:'tasks',stats:'stats',report:'report',personnel:'personnel'}[p[0]]||'tasks'};
}

/* ========== Toast ========== */
function showToast(msg){
  let t=document.querySelector('.dt-toast');
  if(!t){t=document.createElement('div');t.className='dt-toast';document.body.appendChild(t);}
  t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2000);
}

/* ========== 日历 ========== */
function renderCalendar(year,month,rs,re){
  const wd=['一','二','三','四','五','六','日'];
  const fd=new Date(year,month,1),ld=new Date(year,month+1,0);
  let sw=fd.getDay(); sw=sw===0?6:sw-1;
  let h=`<div class="dt-calendar"><div class="dt-calendar-nav"><button class="dt-calendar-nav-btn">‹</button><span class="dt-calendar-month">${year}年${month+1}月</span><button class="dt-calendar-nav-btn">›</button></div><div class="dt-calendar-grid">`;
  wd.forEach(w=>{h+=`<div class="dt-calendar-weekday">${w}</div>`;});
  const pl=new Date(year,month,0).getDate();
  for(let i=sw-1;i>=0;i--) h+=`<div class="dt-calendar-day other-month">${pl-i}</div>`;
  const today=new Date(),rS=rs?new Date(rs):null,rE=re?new Date(re):null;
  for(let d=1;d<=ld.getDate();d++){
    const c=new Date(year,month,d); let cls='dt-calendar-day';
    if(c.toDateString()===today.toDateString()) cls+=' today';
    if(rS&&rE){if(c>=rS&&c<=rE)cls+=' in-range';if(c.toDateString()===rS.toDateString())cls+=' range-start';if(c.toDateString()===rE.toDateString())cls+=' range-end';}
    h+=`<div class="${cls}">${d}</div>`;
  }
  const rem=(7-(sw+ld.getDate())%7)%7;
  for(let i=1;i<=rem;i++) h+=`<div class="dt-calendar-day other-month">${i}</div>`;
  h+=`</div></div>`; return h;
}

/* ========== 一键识别引擎 (CHG-015) ========== */

/* PM 名称别名映射表：key 为 PM_OPTIONS 中的选项，value 为匹配用的别名数组（含全名） */
const PM_ALIAS_MAP = {
  '钟冠': ['钟冠','钟','冠'],
  '吴浩鑫': ['吴浩鑫','浩鑫','吴','鑫'],
  '杨瑞': ['杨瑞','杨','瑞'],
  '罗晓璇': ['罗晓璇','晓璇','罗','璇'],
  '其他-昆仑': ['昆仑'],
  '其他-短信': ['短信'],
  '其他-架构': ['架构']
};

/* 清洗正则：移除非中文、非字母、非数字、非空白、非白名单符号的所有字符 */
/* 白名单：，。；！【】[]{}()（）@#%&= 以及 VvHhDd.-/ */
const CLEAN_REGEX = /[^\u4e00-\u9fa5a-zA-Z0-9\s，。；！【】\[\]\{\}\(\)（）@#%&=.\-\/]/g;

/**
 * 从文本段中识别 PM 名称
 * 优先匹配最长别名（全名优先于单字），避免误匹配
 */
function matchPMs(text) {
  const matched = [];
  // 按别名长度降序排列，优先匹配全名
  const entries = Object.entries(PM_ALIAS_MAP)
    .flatMap(([pm, aliases]) => aliases.map(a => ({ pm, alias: a })))
    .sort((a, b) => b.alias.length - a.alias.length);

  let remaining = text;
  for (const { pm, alias } of entries) {
    if (remaining.includes(alias) && !matched.includes(pm)) {
      matched.push(pm);
      remaining = remaining.replaceAll(alias, ''); // 移除已匹配文字，防止单字重复匹配
    }
  }
  return matched;
}

function parseRequirementText(text) {
  // Step 0: 清洗特殊符号
  text = text.replace(CLEAN_REGEX, '');

  const lines = text.split(/\n/).filter(l => l.trim());
  const results = [];
  lines.forEach(line => {
    const versionRe = /[Vv]?\d+\.\d+\.\d+/g;
    const versions = []; let m;
    while ((m = versionRe.exec(line)) !== null) {
      versions.push({ idx: m.index, val: m[0].startsWith('V') || m[0].startsWith('v') ? m[0] : 'V' + m[0] });
    }
    if (versions.length === 0) {
      results.push(parseSegment(line, ''));
    } else {
      for (let i = 0; i < versions.length; i++) {
        const segStart = versions[i].idx;
        const segEnd = i < versions.length - 1 ? versions[i + 1].idx : line.length;
        let seg = line.substring(segStart, segEnd).replace(versionRe, '').trim();
        results.push(parseSegment(seg, versions[i].val));
      }
    }
  });
  return results;
}

function parseSegment(text, version) {
  let hours = null, title = text;
  // 识别 PM 名称
  const pms = matchPMs(title);
  // 从标题中移除已匹配的 PM 别名文字
  Object.entries(PM_ALIAS_MAP).forEach(([pm, aliases]) => {
    if (pms.includes(pm)) {
      aliases.sort((a, b) => b.length - a.length).forEach(alias => {
        title = title.replaceAll(alias, '');
      });
    }
  });
  // 半天
  if (/半天/.test(title)) { hours = 4; title = title.replace(/半天/g, ''); }
  // Nh/小时/时
  const hm = title.match(/(\d+(?:\.\d{1,2})?)\s*(?:小时|h|H|时)/);
  if (hm && !hours) { const n = parseFloat(hm[1]); if (n >= 0.01 && n <= 24) { hours = n; title = title.replace(hm[0], ''); } }
  // Nd/天/日 — 支持 N/天 格式（斜杠分隔）
  const dm = title.match(/(\d+(?:\.\d{1,2})?)\s*[/]?\s*(?:D|d|天|日)/);
  if (dm && !hours) { const n = parseFloat(dm[1]); if (n >= 0.5 && n <= 7) { hours = n * 8; title = title.replace(dm[0], ''); } }
  // 兜底：行尾独立数字（无单位），默认为小时
  if (!hours) {
    const fb = title.match(/[-\s]+(\d+(?:\.\d{1,2})?)\s*$/);
    if (fb) { const n = parseFloat(fb[1]); if (n >= 0.5 && n <= 200) { hours = n; title = title.replace(fb[0], ''); } }
  }
  // 清理标题：移除残留分隔符 (- 连字符) 和首尾标点空白
  title = title.replace(/\s*-\s*-\s*/g, ' ');           // 连续 - - 合并
  title = title.replace(/^\s*-\s*/g, '');                // 开头 -
  title = title.replace(/\s*-\s*$/g, '');                // 结尾 -
  title = title.replace(/[，。、；：！？,.\s]+$/g, '').replace(/^[，。、；：！？,.\s]+/g, '').trim();
  // 去除多余空格
  title = title.replace(/\s{2,}/g, ' ').trim();
  if (!version.startsWith('V') && !version.startsWith('v') && version) version = 'V' + version;
  return { version, title: title || '', hours: hours ? parseFloat(hours.toFixed(2)) : null, pms };
}

/* ========== Canvas 柱状图 (CHG-028) ========== */
function drawBarChart(canvas,data){
  const ctx=canvas.getContext('2d');
  const W=canvas.width=canvas.parentElement.offsetWidth;
  const H=canvas.height=360;
  const pad={top:40,right:30,bottom:60,left:60};
  const cW=W-pad.left-pad.right, cH=H-pad.top-pad.bottom;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);

  if(!data.length) return;
  const colors=['#165DFF','#00B42A','#FF7D00','#F53F3F'];
  const labels=['前端','后端','测试','总计'];
  const maxVal=Math.max(...data.map(d=>Math.max(d.fe,d.be,d.te,d.total)),1);
  const groupW=cW/data.length;
  const barW=Math.min(groupW*0.16,30);
  const gap=4;

  // Y 轴
  ctx.strokeStyle='#E5E6EB'; ctx.lineWidth=1;
  for(let i=0;i<=5;i++){
    const y=pad.top+cH-cH*(i/5);
    ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(W-pad.right,y);ctx.stroke();
    ctx.fillStyle='#86909C';ctx.font='12px "PingFang SC",sans-serif';ctx.textAlign='right';
    ctx.fillText(Math.round(maxVal*i/5),pad.left-8,y+4);
  }

  data.forEach((d,i)=>{
    const gx=pad.left+groupW*i+groupW/2;
    const vals=[d.fe,d.be,d.te,d.total];
    const startX=gx-(barW*4+gap*3)/2;
    vals.forEach((v,j)=>{
      const bx=startX+(barW+gap)*j;
      const bh=(v/maxVal)*cH;
      const by=pad.top+cH-bh;
      ctx.fillStyle=colors[j]; ctx.fillRect(bx,by,barW,bh);
      // 柱顶数值
      ctx.fillStyle='#1D2129';ctx.font='bold 11px "PingFang SC",sans-serif';ctx.textAlign='center';
      if(v>0) ctx.fillText(v,bx+barW/2,by-4);
    });
    // PM 名称
    ctx.fillStyle='#1D2129';ctx.font='13px "PingFang SC",sans-serif';ctx.textAlign='center';
    ctx.fillText(d.name,gx,H-pad.bottom+20);
  });

  // 图例
  const lgX=W-pad.right-280, lgY=10;
  labels.forEach((l,i)=>{
    ctx.fillStyle=colors[i]; ctx.fillRect(lgX+i*68,lgY,12,12);
    ctx.fillStyle='#4E5969';ctx.font='12px "PingFang SC",sans-serif';ctx.textAlign='left';
    ctx.fillText(l,lgX+i*68+16,lgY+10);
  });
}

/* ========== 主控制器 ========== */
const App={
  init(){
    initMockData();
    this.root=document.getElementById('app-root');
    this.modalOverlay=document.getElementById('modal-overlay');
    this.modalContent=document.getElementById('modal-content');
    this.bindGlobal();
    this.navigate();
  },
  bindGlobal(){
    window.addEventListener('hashchange',()=>this.navigate());
    document.querySelectorAll('.dt-nav-item').forEach(n=>n.addEventListener('click',e=>{e.preventDefault();location.hash=n.getAttribute('href');}));
    document.getElementById('btn-create-task').addEventListener('click',()=>this.openCreateTaskModal());
    this.modalOverlay.addEventListener('click',e=>{if(e.target===this.modalOverlay)this.closeModal();});
    document.getElementById('btn-back').addEventListener('click',()=>{
      if(this._backRoute){location.hash=this._backRoute;}else{history.back();}
    });
  },
  /* 二级及以下页面的返回目标映射 */
  _SUB_PAGE_BACK_MAP: { taskDetail:'#/tasks', personnel:'#/tasks' },
  navigate(){
    const p=parseRoute(); this.updateNav(p.route);
    const hdr=document.querySelector('.dt-header'),main=document.querySelector('.dt-main-container'),ph=document.querySelector('.dt-page-header');
    if(p.route==='fill'){hdr.style.display='none';main.style.padding='0';if(ph)ph.style.display='none';this.renderFill(p.token);return;}
    hdr.style.display='';main.style.padding='';if(ph)ph.style.display='';
    /* 返回按钮逻辑 */
    const backBtn=document.getElementById('btn-back');
    if(this._SUB_PAGE_BACK_MAP[p.route]){
      this._backRoute=this._SUB_PAGE_BACK_MAP[p.route];
      backBtn.style.display='';
    }else{
      this._backRoute=null;
      backBtn.style.display='none';
    }
    ({tasks:()=>this.renderTasks(),taskDetail:()=>this.renderTaskDetail(p.taskId),stats:()=>this.renderStats(),report:()=>this.renderReport(),personnel:()=>this.renderPersonnel()}[p.route]||this.renderTasks.bind(this))();
  },
  updateNav(r){
    const m={tasks:'/tasks',taskDetail:'/tasks',stats:'/stats',report:'/report',personnel:'/personnel'};
    const a=`#${m[r]||'/tasks'}`;
    document.querySelectorAll('.dt-nav-item').forEach(n=>n.classList.toggle('active',n.getAttribute('href')===a));
  },
  setPage(t,d){const te=document.getElementById('page-title'),de=document.getElementById('page-desc');if(te)te.textContent=t;if(de)de.textContent=d;},
  closeModal(){this.modalOverlay.classList.remove('active');},

  /* ===== 任务清单 ===== */
  renderTasks(){
    this.setPage('任务清单','按季度分组的研发工作收集清单与进度追踪。');
    const tasks=Store.getTasks(),recs=Store.getRecords();
    const grouped={};
    tasks.forEach(t=>{
      const m=new Date(t.startDate).getMonth()+1,q=getQuarter(m),k=`${t.year}-${q}`;
      if(!grouped[k])grouped[k]={year:t.year,quarter:q,tasks:[]};
      grouped[k].tasks.push({...t,recordCount:recs.filter(r=>r.taskId===t.id).length});
    });
    // 找最新任务
    const sorted=[...tasks].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const latestId=sorted[0]?.id;

    let h='';
    Object.values(grouped).sort((a,b)=>b.year-a.year||b.quarter.localeCompare(a.quarter)).forEach(g=>{
      h+=`<div class="dt-quarter-group"><div class="dt-quarter-header"><span class="dt-quarter-badge">${g.quarter}</span><span class="dt-quarter-title">${g.year}年度 ${g.quarter}期收集清单</span></div><div class="dt-task-list">
        <div class="dt-task-header" style="grid-template-columns:100px 2.5fr 1fr 80px 100px 80px"><div>时间范围</div><div>任务标题</div><div>维度</div><div>记录数</div><div>状态</div><div>操作</div></div>`;
      g.tasks.forEach(t=>{
        const isLatest=t.id===latestId;
        const sc=t.status==='active'?'dt-badge-active':t.status==='closed'?'dt-badge-closed':'dt-badge-draft';
        const st=t.status==='active'?'收集中':t.status==='closed'?'已归档':'草稿';
        const dl=TIME_DIMS.find(d=>d.value===t.timeDimension)?.label||t.timeDimension;
        h+=`<div class="dt-task-row${isLatest?' latest':''}" data-task-id="${t.id}" style="grid-template-columns:100px 2.5fr 1fr 80px 100px 80px;padding:8px 24px${isLatest?';border-left:3px solid var(--color-primary);background:var(--color-primary-light)':''}">
          <div class="dt-task-cell-meta" style="display:flex;flex-direction:column;align-items:center;font-size:12px;line-height:1.5"><span>${fmtDate(t.startDate)}</span><span style="color:var(--color-text-4)">|</span><span>${fmtDate(t.endDate)}</span></div>
          <div class="dt-task-cell-title">${t.title}</div>
          <div><span class="dt-tag dt-tag-gray">${dl}</span></div>
          <div class="dt-task-cell-meta" style="color:var(--color-text-2);text-align:center">${t.recordCount} 条</div>
          <div class="dt-task-cell-status"><span class="dt-badge ${sc}">${st}</span></div>
          <div><button class="dt-btn-text" data-view="${t.id}">查看</button></div>
        </div>`;
      });
      h+='</div></div>';
    });
    this.root.innerHTML=h;
    this.root.querySelectorAll('.dt-task-row').forEach(r=>r.addEventListener('click',()=>{location.hash=`#/task/${r.dataset.taskId}`;}));
    this.root.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();location.hash=`#/task/${b.dataset.view}`;}));
  },

  /* ===== 任务详情 ===== */
  _currentDetailTid:null,
  _currentDetailTab:'records',
  renderTaskDetail(tid){
    this._currentDetailTid=tid;
    const task=Store.getTasks().find(t=>t.id===tid);
    if(!task){this.root.innerHTML='<div class="dt-empty"><div class="dt-empty-text">任务不存在</div></div>';return;}
    this.setPage(task.title,'管理该收集任务下的全部提交数据与链接分发。');
    this.root.innerHTML=`<div class="dt-breadcrumb"><a href="#/tasks">任务清单</a><span class="dt-breadcrumb-sep">›</span><span class="dt-breadcrumb-current">${task.title}</span></div>
      <div class="dt-tabs" id="detail-tabs"><button class="dt-tab active" data-tab="records">提交数据</button><button class="dt-tab" data-tab="links">链接管理</button><button class="dt-tab" data-tab="summary">汇总报表</button></div>
      <div id="detail-tab-content"></div>`;
    const renderTab=tab=>{
      this._currentDetailTab=tab;
      const c=document.getElementById('detail-tab-content');
      const recs=Store.getRecords().filter(r=>r.taskId===tid),staff=Store.getStaff(),links=Store.getLinks().filter(l=>l.taskId===tid),mg=Store.getMatchGroups().filter(g=>g.taskId===tid);
      if(tab==='records'){c.innerHTML=this._recordsTab(recs,staff,tid);this._bindRecordsActions(tid);}
      else if(tab==='links') c.innerHTML=this._linksTab(links,staff);
      else c.innerHTML=this._summaryTab(mg,tid);
    };
    document.querySelectorAll('#detail-tabs .dt-tab').forEach(b=>b.addEventListener('click',()=>{
      document.querySelectorAll('#detail-tabs .dt-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderTab(b.dataset.tab);
    }));
    renderTab('records');
  },

  _recordsTab(recs,staff,tid){
    const sorted=[...recs].sort((a,b)=>a.staffId.localeCompare(b.staffId)||new Date(a.createdAt)-new Date(b.createdAt));
    const fmtDt=d=>{const t=new Date(d);return `${t.getMonth()+1}/${t.getDate()} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;};
    let h=`<div class="dt-toolbar"><div class="dt-toolbar-left"><input class="dt-search" placeholder="搜索需求标题 / 版本号..." /></div><div class="dt-toolbar-right"><button class="dt-btn dt-btn-primary dt-btn-sm">手动新增</button></div></div>
      <div class="dt-data-card"><table class="dt-table"><thead><tr><th>序号</th><th>人员</th><th>角色</th><th>版本号</th><th>需求标题</th><th>产品经理</th><th>工时(h)</th><th>提交时间</th><th>修改时间</th><th>操作</th></tr></thead><tbody>`;
    sorted.forEach((r,i)=>{
      const s=staff.find(x=>x.id===r.staffId);
      h+=`<tr data-rid="${r.id}"><td>${i+1}</td><td style="font-weight:600;color:var(--color-text-1)">${s?s.name:'未知'}</td><td><span class="dt-tag ${s?ROLE_TAG_MAP[s.role]:'dt-tag-gray'}">${s?ROLE_MAP[s.role]:'未知'}</span></td>
        <td class="cell-version"><span style="font-family:var(--font-mono);font-size:13px">${r.version}</span></td><td class="cell-title">${r.requirementTitle}</td><td class="cell-pm">${r.productManagers.join('、')}</td>
        <td class="cell-hours" style="font-weight:600;color:var(--color-primary)">${r.hours}</td><td class="dt-task-cell-meta">${fmtDt(r.createdAt)}</td><td class="dt-task-cell-meta">${fmtDt(r.updatedAt)}</td>
        <td class="col-actions"><button class="dt-btn-text btn-edit-rec" data-rid="${r.id}">编辑</button><button class="dt-btn-danger-text btn-del-rec" data-rid="${r.id}">删除</button></td></tr>`;
    });
    if(!sorted.length) h+='<tr><td colspan="10" style="text-align:center;color:var(--color-text-3);padding:40px">暂无提交数据</td></tr>';
    h+='</tbody></table></div>';
    return h;
  },

  /* GAP-01: 内联编辑 */
  _bindRecordsActions(tid){
    // 编辑按钮
    document.querySelectorAll('.btn-edit-rec').forEach(btn=>btn.addEventListener('click',e=>{
      e.stopPropagation();
      const rid=btn.dataset.rid;
      const tr=btn.closest('tr');
      if(btn.textContent==='编辑'){
        const recs=Store.getRecords();
        const rec=recs.find(r=>r.id===rid);
        if(!rec) return;
        tr.classList.add('editing');
        tr.querySelector('.cell-version').innerHTML=`<input class="dt-input" style="height:28px;font-size:13px;width:100px" value="${rec.version}" data-field="version">`;
        tr.querySelector('.cell-title').innerHTML=`<input class="dt-input" style="height:28px;font-size:13px" value="${rec.requirementTitle}" data-field="title">`;
        tr.querySelector('.cell-pm').innerHTML=`<input class="dt-input" style="height:28px;font-size:13px;width:80px" value="${rec.productManagers.join('、')}" data-field="pm">`;
        tr.querySelector('.cell-hours').innerHTML=`<input class="dt-input" type="number" step="0.01" style="height:28px;font-size:13px;width:70px" value="${rec.hours}" data-field="hours">`;
        btn.textContent='保存';
        btn.style.color='var(--color-success)';
        btn.style.fontWeight='600';
        // 聚焦第一个输入框
        const firstInput=tr.querySelector('input[data-field]');
        if(firstInput) firstInput.focus();
      } else {
        // 保存逻辑
        const recs=Store.getRecords();
        const idx=recs.findIndex(r=>r.id===rid);
        if(idx===-1) return;
        const vInput=tr.querySelector('[data-field="version"]');
        const tInput=tr.querySelector('[data-field="title"]');
        const pInput=tr.querySelector('[data-field="pm"]');
        const hInput=tr.querySelector('[data-field="hours"]');
        if(vInput) recs[idx].version=vInput.value.trim();
        if(tInput) recs[idx].requirementTitle=tInput.value.trim();
        if(pInput) recs[idx].productManagers=pInput.value.split(/[、,]/).map(s=>s.trim()).filter(Boolean);
        if(hInput) recs[idx].hours=parseFloat(parseFloat(hInput.value).toFixed(2))||0;
        recs[idx].updatedAt=new Date().toISOString();
        Store.saveRecords(recs);
        showToast('保存成功');
        this.renderTaskDetail(tid);
      }
    }));
    // GAP-02: 删除按钮
    document.querySelectorAll('.btn-del-rec').forEach(btn=>btn.addEventListener('click',e=>{
      e.stopPropagation();
      const rid=btn.dataset.rid;
      if(!confirm('确认删除该记录？')) return;
      const recs=Store.getRecords().filter(r=>r.id!==rid);
      Store.saveRecords(recs);
      showToast('已删除');
      this.renderTaskDetail(tid);
    }));
  },

  _linksTab(links,staff){
    let h=`<div style="margin-bottom:16px"><label class="dt-form-label">预设通知文本</label><textarea class="dt-input" id="preset-text" style="height:60px;resize:vertical" placeholder="请填写本周工作内容，链接如下：">请填写本周工作内容，链接如下：</textarea></div>
      <div class="dt-toolbar"><div class="dt-toolbar-left"><span style="font-size:13px;color:var(--color-text-3)">共 ${links.length} 条链接</span></div><div class="dt-toolbar-right"><button class="dt-btn dt-btn-primary dt-btn-sm">重新生成链接</button></div></div>
      <div class="dt-data-card"><table class="dt-table"><thead><tr><th>人员</th><th>角色</th><th>专属链接</th><th>提交状态</th><th>操作</th></tr></thead><tbody>`;
    links.forEach(lk=>{
      const s=staff.find(x=>x.id===lk.staffId);
      const sb=lk.isSubmitted?'<span class="dt-badge dt-badge-active">已提交</span>':'<span class="dt-badge dt-badge-draft">未提交</span>';
      h+=`<tr><td style="font-weight:600;color:var(--color-text-1)">${s?s.name:'未知'}</td><td><span class="dt-tag ${s?ROLE_TAG_MAP[s.role]:'dt-tag-gray'}">${s?ROLE_MAP[s.role]:'未知'}</span></td>
        <td><a href="${lk.url}" target="_blank" class="dt-link-url" style="color:var(--color-primary);text-decoration:none">${lk.url}</a></td><td>${sb}</td>
        <td class="col-actions"><button class="dt-btn-text" onclick="var t=document.getElementById('preset-text').value;navigator.clipboard.writeText(t+'\\n${lk.url}');showToast('已复制')">复制</button><button class="dt-btn-text" onclick="showToast('已通过钉钉发送给 ${s?s.name:''}')">发送</button></td></tr>`;
    });
    h+='</tbody></table></div>';return h;
  },

  _summaryTab(mg,tid){return this._renderReportTable(mg,tid,false);},

  /* ===== 汇总报表独立页 (GAP-04/05/06) ===== */
  _reportState:{taskId:null,sortBy:'pm',currentPage:1,manualRows:[]},
  renderReport(){
    this.setPage('汇总报表','需求维度工时匹配汇总与多维排序报表。');
    const tasks=Store.getTasks(),mg=Store.getMatchGroups();
    const defaultTask=tasks.find(t=>t.status==='active')||tasks[0];
    this._reportState.taskId=defaultTask?.id||null;
    this._reportState.currentPage=1;
    this._reportState.manualRows=[];
    let h=`<div class="dt-toolbar"><div class="dt-toolbar-left"><select class="dt-select" id="report-task-select" style="width:auto;min-width:300px;height:32px;font-size:13px">${tasks.map(t=>`<option value="${t.id}"${t.id===defaultTask?.id?' selected':''}>${t.title}</option>`).join('')}</select></div><div class="dt-toolbar-right" id="report-total-hours"></div></div>
      <div id="report-content"></div>`;
    this.root.innerHTML=h;
    document.getElementById('report-task-select').addEventListener('change',e=>{
      this._reportState.taskId=e.target.value;
      this._reportState.currentPage=1;
      this._reportState.manualRows=[];
      this._refreshReport();
    });
    if(defaultTask) this._refreshReport();
  },

  _refreshReport(){
    const mg=Store.getMatchGroups();
    const groups=mg.filter(g=>g.taskId===this._reportState.taskId);
    document.getElementById('report-content').innerHTML=this._renderReportTable(groups,this._reportState.taskId,true);
    this._bindReportActions();
  },

  _renderReportTable(groups,taskId,showPagination){
    const remarks=Store.getRemarks();
    const rp=(arr)=>{if(!arr||!arr.length)return'<span style="color:var(--color-text-4)">—</span>';return arr.map(p=>`<span class="dt-dept-person">${p.staffName}<span class="dt-dept-person-hours">/${p.hours}h</span></span>`).join('');};
    const sumH=arr=>arr?arr.reduce((s,p)=>s+p.hours,0):0;

    // 合并手动添加的行
    const allGroups=[...groups,...this._reportState.manualRows];

    let totalFe=0,totalBe=0,totalTe=0;
    allGroups.forEach(g=>{totalFe+=sumH(g.frontend);totalBe+=sumH(g.backend);totalTe+=sumH(g.test);});
    const grandTotal=totalFe+totalBe+totalTe;

    // GAP-04: 排序逻辑
    const sortBy=this._reportState.sortBy;
    const sorted=[...allGroups].sort((a,b)=>{
      if(sortBy==='pm') return pinyinSort(a.productManagers?.[0]||'',b.productManagers?.[0]||'');
      const getStaffName=(g,role)=>{const arr=g[role];return arr&&arr[0]?arr[0].staffName:'';};
      if(sortBy==='frontend') return pinyinSort(getStaffName(a,'frontend'),getStaffName(b,'frontend'));
      if(sortBy==='backend') return pinyinSort(getStaffName(a,'backend'),getStaffName(b,'backend'));
      if(sortBy==='test') return pinyinSort(getStaffName(a,'test'),getStaffName(b,'test'));
      return 0;
    });

    // GAP-06: 分页
    const page=this._reportState.currentPage;
    const totalPages=Math.max(1,Math.ceil(sorted.length/PAGE_SIZE));
    const pageData=sorted.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
    const globalOffset=(page-1)*PAGE_SIZE;

    const sortBtnStyle=(key)=>sortBy===key?'font-weight:600;color:var(--color-primary)':'color:var(--color-text-3)';

    let h=`<div style="text-align:right;margin-bottom:12px;font-size:15px;font-weight:600;color:var(--color-text-1)">当前总工时：<span style="color:var(--color-primary)">${grandTotal}</span> h</div>
      <div class="dt-toolbar"><div class="dt-toolbar-left"><button class="dt-btn dt-btn-outline dt-btn-sm" id="btn-report-add">+ 新增行</button>
        <span style="font-size:12px;color:var(--color-text-3);margin-left:12px">排序：</span>
        <button class="dt-btn-text btn-report-sort" data-sort="pm" style="${sortBtnStyle('pm')}">产品经理</button><button class="dt-btn-text btn-report-sort" data-sort="frontend" style="${sortBtnStyle('frontend')}">前端</button><button class="dt-btn-text btn-report-sort" data-sort="backend" style="${sortBtnStyle('backend')}">后端</button><button class="dt-btn-text btn-report-sort" data-sort="test" style="${sortBtnStyle('test')}">测试</button>
      </div></div>
      <div class="dt-data-card"><table class="dt-dept-table" style="font-size:14px"><thead><tr><th>序号</th><th>版本号</th><th style="min-width:200px">需求名称</th><th>产品经理</th><th>前端（人员/工时）</th><th>后端（人员/工时）</th><th>测试（人员/工时）</th><th>总计/h</th><th style="min-width:120px">备注</th></tr></thead><tbody>`;

    pageData.forEach((g,i)=>{
      const rowTotal=sumH(g.frontend)+sumH(g.backend)+sumH(g.test);
      const rmk=remarks[g.id]||'';
      h+=`<tr><td>${globalOffset+i+1}</td><td><span style="font-family:var(--font-mono);font-size:13px">${g.version||''}</span></td>
        <td style="font-weight:500;color:var(--color-text-1)">${g.mergedTitle||''}</td><td>${(g.productManagers||[]).join('、')}</td>
        <td><div class="dt-dept-cell-people">${rp(g.frontend)}</div></td><td><div class="dt-dept-cell-people">${rp(g.backend)}</div></td><td><div class="dt-dept-cell-people">${rp(g.test)}</div></td>
        <td style="font-weight:700;color:var(--color-text-1)">${rowTotal}</td>
        <td><input type="text" class="dt-input" style="height:28px;font-size:13px;border-color:transparent;background:transparent;padding:2px 6px" value="${rmk}" data-gid="${g.id}" placeholder="添加备注..." /></td></tr>`;
    });
    // 底部合计行
    h+=`<tr style="background:var(--color-bg-2);font-weight:700"><td colspan="4" style="text-align:right;padding-right:16px">列合计</td>
      <td style="color:var(--color-primary)">${totalFe}h</td><td style="color:#00B42A">${totalBe}h</td><td style="color:#FF7D00">${totalTe}h</td><td style="color:var(--color-text-1)">${grandTotal}h</td><td></td></tr>`;
    h+='</tbody></table></div>';

    if(showPagination){
      const prevDis=page<=1?'disabled':'';
      const nextDis=page>=totalPages?'disabled':'';
      let pageNums='';
      for(let p=1;p<=totalPages;p++){
        if(p===page) pageNums+=`<span style="padding:4px 12px;background:var(--color-primary);color:#fff;border-radius:var(--radius-sm)">${p}</span>`;
        else pageNums+=`<button class="dt-btn dt-btn-outline dt-btn-sm btn-report-page" data-page="${p}">${p}</button>`;
      }
      h+=`<div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;font-size:13px;color:var(--color-text-3)"><span>共 ${sorted.length} 条</span><div style="display:flex;gap:8px"><button class="dt-btn dt-btn-outline dt-btn-sm btn-report-prev" ${prevDis}>上一页</button>${pageNums}<button class="dt-btn dt-btn-outline dt-btn-sm btn-report-next" ${nextDis}>下一页</button></div><span>每页 ${PAGE_SIZE} 条</span></div>`;
    }

    // 绑备注保存
    setTimeout(()=>{
      document.querySelectorAll('input[data-gid]').forEach(inp=>{
        inp.addEventListener('blur',()=>{
          const rm=Store.getRemarks(); rm[inp.dataset.gid]=inp.value; Store.saveRemarks(rm);
        });
      });
    },100);

    return h;
  },

  _bindReportActions(){
    // GAP-04: 排序切换
    document.querySelectorAll('.btn-report-sort').forEach(btn=>btn.addEventListener('click',()=>{
      this._reportState.sortBy=btn.dataset.sort;
      this._reportState.currentPage=1;
      this._refreshReport();
    }));
    // GAP-05: 手动添加行
    document.getElementById('btn-report-add')?.addEventListener('click',()=>{
      this._reportState.manualRows.push({
        id:uid(),taskId:this._reportState.taskId,mergedTitle:'',version:'',productManagers:[],
        frontend:[],backend:[],test:[],confidence:1,status:'manual_merged'
      });
      this._refreshReport();
      showToast('已添加空白行');
    });
    // GAP-06: 分页
    document.querySelector('.btn-report-prev')?.addEventListener('click',()=>{
      if(this._reportState.currentPage>1){this._reportState.currentPage--;this._refreshReport();}
    });
    document.querySelector('.btn-report-next')?.addEventListener('click',()=>{
      this._reportState.currentPage++;this._refreshReport();
    });
    document.querySelectorAll('.btn-report-page').forEach(btn=>btn.addEventListener('click',()=>{
      this._reportState.currentPage=parseInt(btn.dataset.page);this._refreshReport();
    }));
  },

  /* ===== 周期统计 (GAP-07) ===== */
  _statsFilter:{year:new Date().getFullYear(),quarter:getQuarter(new Date().getMonth()+1),taskId:'all'},
  renderStats(){
    this.setPage('周期统计','多维度研发效能可视化分析与洞察报表。');
    const h=`<div class="dt-tabs" id="stats-tabs"><button class="dt-tab active" data-tab="dept">部门全观</button><button class="dt-tab" data-tab="personal">个人聚焦</button></div><div id="stats-tab-content"></div>`;
    this.root.innerHTML=h;
    const render=tab=>{
      const c=document.getElementById('stats-tab-content');
      if(tab==='dept'){c.innerHTML=this._deptStats();this._bindDeptChart();this._bindStatsFilters();}
      else{c.innerHTML=this._personalStats();this._bindPersonal();}
    };
    document.querySelectorAll('#stats-tabs .dt-tab').forEach(b=>b.addEventListener('click',()=>{
      document.querySelectorAll('#stats-tabs .dt-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');render(b.dataset.tab);
    }));
    render('dept');
  },

  _getFilteredStatsData(){
    const tasks=Store.getTasks(),mg=Store.getMatchGroups(),recs=Store.getRecords(),staff=Store.getStaff();
    const f=this._statsFilter;
    // 筛选年度和季度的任务
    let qTasks=tasks.filter(t=>{
      const m=new Date(t.startDate).getMonth()+1;
      return t.year===f.year&&getQuarter(m)===f.quarter;
    });
    // 如果选了具体周期
    let qTaskIds;
    if(f.taskId!=='all'){
      qTaskIds=new Set([f.taskId]);
    } else {
      qTaskIds=new Set(qTasks.map(t=>t.id));
    }
    const qRecs=recs.filter(r=>qTaskIds.has(r.taskId));
    const qMg=mg.filter(g=>qTaskIds.has(g.taskId));
    return {tasks,qTasks,qRecs,qMg,staff,qTaskIds};
  },

  _deptStats(){
    const {qTasks,qRecs,qMg,staff}=this._getFilteredStatsData();
    const allTasks=Store.getTasks();
    const f=this._statsFilter;
    const totalH=qRecs.reduce((s,r)=>s+r.hours,0);
    const sumH=arr=>arr?arr.reduce((s,p)=>s+p.hours,0):0;

    // 年份选项
    const years=[...new Set(allTasks.map(t=>t.year))].sort((a,b)=>b-a);
    if(!years.includes(f.year)) years.unshift(f.year);
    // 季度下的任务
    const qTasksForSelect=allTasks.filter(t=>{const m=new Date(t.startDate).getMonth()+1;return t.year===f.year&&getQuarter(m)===f.quarter;});

    let h=`<div class="dt-toolbar" style="margin-bottom:16px"><div class="dt-toolbar-left">
      <select class="dt-select" id="stats-year" style="width:auto;height:32px;font-size:13px">${years.map(y=>`<option value="${y}"${y===f.year?' selected':''}>${y}年</option>`).join('')}</select>
      <select class="dt-select" id="stats-quarter" style="width:auto;height:32px;font-size:13px">${['Q1','Q2','Q3','Q4'].map(q=>`<option value="${q}"${q===f.quarter?' selected':''}>${q}</option>`).join('')}</select>
      <select class="dt-select" id="stats-task" style="width:auto;min-width:200px;height:32px;font-size:13px"><option value="all"${f.taskId==='all'?' selected':''}>全部周期</option>${qTasksForSelect.map(t=>`<option value="${t.id}"${t.id===f.taskId?' selected':''}>${t.title}</option>`).join('')}</select>
    </div></div>`;

    h+=`<div class="dt-stat-cards">
      <div class="dt-stat-card"><div class="dt-stat-card-label">当前季度总工时</div><div class="dt-stat-card-value">${totalH}<span class="dt-stat-card-unit">小时</span></div></div>
      <div class="dt-stat-card"><div class="dt-stat-card-label">提交记录数</div><div class="dt-stat-card-value">${qRecs.length}<span class="dt-stat-card-unit">条</span></div></div>
      <div class="dt-stat-card"><div class="dt-stat-card-label">研发人员</div><div class="dt-stat-card-value">${staff.length}<span class="dt-stat-card-unit">人</span></div></div>
      <div class="dt-stat-card"><div class="dt-stat-card-label">收集任务数</div><div class="dt-stat-card-value">${qTasks.length}<span class="dt-stat-card-unit">个</span></div></div>
    </div>`;

    // 明细表：累计工时数值
    h+=`<div class="dt-section-title">部门工时汇总明细</div><div class="dt-data-card"><table class="dt-dept-table"><thead><tr><th>序号</th><th>版本号</th><th>需求名称</th><th>产品经理</th><th>前端累计工时</th><th>后端累计工时</th><th>测试累计工时</th></tr></thead><tbody>`;
    qMg.forEach((g,i)=>{
      h+=`<tr><td>${i+1}</td><td><span style="font-family:var(--font-mono);font-size:12px">${g.version}</span></td><td style="font-weight:500;color:var(--color-text-1)">${g.mergedTitle}</td><td>${g.productManagers.join('、')}</td>
        <td style="font-weight:600;color:#165DFF">${sumH(g.frontend)}h</td><td style="font-weight:600;color:#00B42A">${sumH(g.backend)}h</td><td style="font-weight:600;color:#FF7D00">${sumH(g.test)}h</td></tr>`;
    });
    if(!qMg.length) h+='<tr><td colspan="7" style="text-align:center;color:var(--color-text-3);padding:40px">当前筛选条件下暂无数据</td></tr>';
    h+='</tbody></table></div>';

    // 柱状图
    h+=`<div class="dt-section-title" style="margin-top:24px">产品经理工时分布</div><div class="dt-data-card" style="padding:16px"><canvas id="dept-chart"></canvas></div>`;

    // 准备图表数据
    this._chartData=[];
    const pmMap={};
    qMg.forEach(g=>{
      const pm=g.productManagers[0]||'未知';
      if(!pmMap[pm])pmMap[pm]={name:pm,fe:0,be:0,te:0,total:0};
      pmMap[pm].fe+=sumH(g.frontend);pmMap[pm].be+=sumH(g.backend);pmMap[pm].te+=sumH(g.test);
      pmMap[pm].total=pmMap[pm].fe+pmMap[pm].be+pmMap[pm].te;
    });
    this._chartData=Object.values(pmMap);

    return h;
  },

  /* GAP-07: 筛选器联动绑定 */
  _bindStatsFilters(){
    const refresh=()=>{
      const c=document.getElementById('stats-tab-content');
      c.innerHTML=this._deptStats();
      this._bindDeptChart();
      this._bindStatsFilters();
    };
    document.getElementById('stats-year')?.addEventListener('change',e=>{
      this._statsFilter.year=parseInt(e.target.value);
      this._statsFilter.taskId='all';
      refresh();
    });
    document.getElementById('stats-quarter')?.addEventListener('change',e=>{
      this._statsFilter.quarter=e.target.value;
      this._statsFilter.taskId='all';
      refresh();
    });
    document.getElementById('stats-task')?.addEventListener('change',e=>{
      this._statsFilter.taskId=e.target.value;
      refresh();
    });
  },

  _bindDeptChart(){
    setTimeout(()=>{
      const cv=document.getElementById('dept-chart');
      if(cv&&this._chartData) drawBarChart(cv,this._chartData);
    },50);
  },

  _personalStats(){
    const staff=Store.getStaff(),recs=Store.getRecords();
    const first=staff[0];
    // CHG-029: 单行平铺
    let h=`<div class="dt-section-title">选择成员</div><div class="dt-capsule-group" style="flex-wrap:nowrap;overflow-x:auto">`;
    staff.forEach(s=>{
      h+=`<button class="dt-capsule${s.id===first?.id?' active':''}" data-staff-id="${s.id}"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${ROLE_COLORS[s.role]};margin-right:6px;vertical-align:middle"></span>${s.name}</button>`;
    });
    h+='</div><div id="personal-detail"></div>';
    if(first) h+=this._personDetail(first,recs);
    return h;
  },

  _personDetail(p,recs){
    const pr=recs.filter(r=>r.staffId===p.id),tH=pr.reduce((s,r)=>s+r.hours,0),tasks=Store.getTasks();
    const tg={};pr.forEach(r=>{if(!tg[r.taskId])tg[r.taskId]=[];tg[r.taskId].push(r);});
    let h=`<div class="dt-profile-header" style="margin-top:20px"><div class="dt-profile-avatar">${p.name.charAt(0)}</div><div class="dt-profile-info"><div class="dt-profile-name">${p.name}</div><div class="dt-profile-role"><span class="dt-tag ${ROLE_TAG_MAP[p.role]}">${ROLE_MAP[p.role]}</span></div></div>
      <div class="dt-profile-stats"><div class="dt-profile-stat-item"><div class="dt-profile-stat-val">${tH}</div><div class="dt-profile-stat-lbl">总工时(h)</div></div><div class="dt-profile-stat-item"><div class="dt-profile-stat-val">${pr.length}</div><div class="dt-profile-stat-lbl">记录数</div></div><div class="dt-profile-stat-item"><div class="dt-profile-stat-val">${Object.keys(tg).length}</div><div class="dt-profile-stat-lbl">参与周期</div></div></div></div>
      <div class="dt-section-title">参与的收集任务</div><div class="dt-accordion">`;
    Object.keys(tg).forEach(tid=>{
      const task=tasks.find(t=>t.id===tid),rs=tg[tid],th=rs.reduce((s,r)=>s+r.hours,0);
      h+=`<div class="dt-accordion-item"><button class="dt-accordion-head"><span class="dt-accordion-head-title">${task?task.title:'未知'}</span><span class="dt-accordion-head-meta"><span>${rs.length} 条</span><span style="color:var(--color-primary);font-weight:600">${th}h</span><span class="dt-accordion-arrow">▸</span></span></button>
        <div class="dt-accordion-body"><div class="dt-accordion-content"><table class="dt-table" style="margin-top:8px"><thead><tr><th>需求标题</th><th>版本号</th><th>产品经理</th><th>工时(h)</th></tr></thead><tbody>`;
      rs.forEach(r=>{h+=`<tr><td style="font-weight:500;color:var(--color-text-1)">${r.requirementTitle}</td><td><span style="font-family:var(--font-mono);font-size:13px">${r.version}</span></td><td>${r.productManagers.join('、')}</td><td style="font-weight:600;color:var(--color-primary)">${r.hours}</td></tr>`;});
      h+='</tbody></table></div></div></div>';
    });
    h+='</div>';return h;
  },

  _bindPersonal(){
    const recs=Store.getRecords(),staff=Store.getStaff();
    document.querySelectorAll('.dt-capsule').forEach(b=>b.addEventListener('click',()=>{
      document.querySelectorAll('.dt-capsule').forEach(x=>x.classList.remove('active'));b.classList.add('active');
      const p=staff.find(s=>s.id===b.dataset.staffId);if(!p)return;
      // 移除旧面板
      const c=document.getElementById('stats-tab-content');
      ['dt-profile-header','dt-section-title','dt-accordion'].forEach(cls=>{c.querySelectorAll('.'+cls).forEach(e=>{if(cls==='dt-section-title'&&e.textContent==='选择成员')return;e.remove();});});
      c.insertAdjacentHTML('beforeend',this._personDetail(p,recs));
      c.querySelectorAll('.dt-accordion-head').forEach(h=>h.addEventListener('click',()=>h.closest('.dt-accordion-item').classList.toggle('open')));
    }));
    document.querySelectorAll('.dt-accordion-head').forEach(h=>h.addEventListener('click',()=>h.closest('.dt-accordion-item').classList.toggle('open')));
  },

  /* ===== 人员管理 (GAP-08) ===== */
  renderPersonnel(){
    this.setPage('团队人员','管理系统中前端、后端和测试的研发人员名单。');
    const staff=Store.getStaff();
    let h=`<div class="dt-toolbar"><div class="dt-toolbar-left"><span style="font-size:13px;color:var(--color-text-3)">共 ${staff.length} 位研发人员</span></div><div class="dt-toolbar-right"><button class="dt-btn dt-btn-primary dt-btn-sm" id="btn-add-staff">新增人员</button></div></div>
      <div class="dt-data-card"><table class="dt-table"><thead><tr><th>姓名</th><th>角色</th><th>状态</th><th>加入时间</th><th>操作</th></tr></thead><tbody>`;
    staff.forEach(s=>{h+=`<tr data-sid="${s.id}"><td style="font-weight:600;color:var(--color-text-1)">${s.name}</td><td><span class="dt-tag ${ROLE_TAG_MAP[s.role]}">${ROLE_MAP[s.role]}</span></td><td><span class="dt-badge ${s.isActive?'dt-badge-active':'dt-badge-draft'}">${s.isActive?'在职':'离职'}</span></td><td class="dt-task-cell-meta">${s.createdAt}</td><td class="col-actions"><button class="dt-btn-text btn-edit-staff" data-sid="${s.id}">编辑</button><button class="dt-btn-danger-text btn-del-staff" data-sid="${s.id}">删除</button></td></tr>`;});
    h+='</tbody></table></div>';this.root.innerHTML=h;
    document.getElementById('btn-add-staff')?.addEventListener('click',()=>this.openAddStaffModal());
    // GAP-08: 编辑绑定
    document.querySelectorAll('.btn-edit-staff').forEach(btn=>btn.addEventListener('click',()=>{
      const sid=btn.dataset.sid;
      const s=Store.getStaff().find(x=>x.id===sid);
      if(!s) return;
      this.openEditStaffModal(s);
    }));
    // GAP-08: 删除绑定
    document.querySelectorAll('.btn-del-staff').forEach(btn=>btn.addEventListener('click',()=>{
      const sid=btn.dataset.sid;
      const s=Store.getStaff().find(x=>x.id===sid);
      if(!confirm(`确认删除人员「${s?s.name:''}」？`)) return;
      const list=Store.getStaff().filter(x=>x.id!==sid);
      Store.saveStaff(list);
      showToast('已删除');
      this.renderPersonnel();
    }));
  },

  openAddStaffModal(){
    this.modalContent.innerHTML=`<div class="dt-modal-header"><div class="dt-modal-title">新增研发人员</div><button class="dt-close" id="mc">×</button></div><div class="dt-modal-body" style="display:block"><div class="dt-form-item"><label class="dt-form-label">姓名</label><input type="text" class="dt-input" id="sn" placeholder="请输入姓名"></div><div class="dt-form-item"><label class="dt-form-label">角色</label><select class="dt-select" id="sr"><option value="frontend">前端</option><option value="backend">后端</option><option value="test">测试</option></select></div></div><div class="dt-modal-footer"><button class="dt-btn dt-btn-outline" id="sc">取消</button><button class="dt-btn dt-btn-primary" id="sf">确认添加</button></div>`;
    this.modalOverlay.classList.add('active');
    document.getElementById('mc').addEventListener('click',()=>this.closeModal());
    document.getElementById('sc').addEventListener('click',()=>this.closeModal());
    document.getElementById('sf').addEventListener('click',()=>{const n=document.getElementById('sn').value.trim(),r=document.getElementById('sr').value;if(n.length<2){showToast('姓名至少2个字符');return;}const st=Store.getStaff();st.push({id:uid(),name:n,role:r,isActive:true,createdAt:new Date().toISOString().split('T')[0]});Store.saveStaff(st);this.closeModal();this.renderPersonnel();showToast(`已添加：${n}`);});
  },

  /* GAP-08: 编辑人员弹窗 */
  openEditStaffModal(staffItem){
    this.modalContent.innerHTML=`<div class="dt-modal-header"><div class="dt-modal-title">编辑人员</div><button class="dt-close" id="mc">×</button></div><div class="dt-modal-body" style="display:block"><div class="dt-form-item"><label class="dt-form-label">姓名</label><input type="text" class="dt-input" id="sn" value="${staffItem.name}" placeholder="请输入姓名"></div><div class="dt-form-item"><label class="dt-form-label">角色</label><select class="dt-select" id="sr"><option value="frontend"${staffItem.role==='frontend'?' selected':''}>前端</option><option value="backend"${staffItem.role==='backend'?' selected':''}>后端</option><option value="test"${staffItem.role==='test'?' selected':''}>测试</option></select></div></div><div class="dt-modal-footer"><button class="dt-btn dt-btn-outline" id="sc">取消</button><button class="dt-btn dt-btn-primary" id="sf">保存修改</button></div>`;
    this.modalOverlay.classList.add('active');
    document.getElementById('mc').addEventListener('click',()=>this.closeModal());
    document.getElementById('sc').addEventListener('click',()=>this.closeModal());
    document.getElementById('sf').addEventListener('click',()=>{
      const n=document.getElementById('sn').value.trim(),r=document.getElementById('sr').value;
      if(n.length<2){showToast('姓名至少2个字符');return;}
      const list=Store.getStaff();
      const idx=list.findIndex(x=>x.id===staffItem.id);
      if(idx!==-1){list[idx].name=n;list[idx].role=r;Store.saveStaff(list);}
      this.closeModal();this.renderPersonnel();showToast(`已更新：${n}`);
    });
  },

  /* ===== 填写页 (GAP-03: 自定义多选下拉) ===== */
  renderFill(token){
    const staff=Store.getStaff(),p=staff[0],tasks=Store.getTasks(),task=tasks[0];
    let fillRows=[{idx:1,title:'用户中心改版',version:'V4.633.0',pms:['杨瑞'],hours:5},{idx:2,title:'AI Agent 优化',version:'V4.633.0',pms:['钟冠'],hours:3},{idx:3,title:'',version:'',pms:[],hours:''}];

    const renderPmTags=(pms)=>pms.map(pm=>`<span class="dt-pm-tag">${pm}<span class="dt-pm-tag-close" data-pm="${pm}">×</span></span>`).join('');

    const renderRows=()=>fillRows.map((r,i)=>`<div class="dt-fill-row" data-row-idx="${i}"><div class="dt-fill-row-idx">${i+1}</div><div><input class="dt-input fill-input-title" value="${r.title}" placeholder="请输入需求标题"></div><div><input class="dt-input fill-input-version" value="${r.version}" placeholder="如 V2.333.0"></div>
      <div class="dt-pm-selector" data-row-idx="${i}">
        <div class="dt-pm-trigger">${r.pms.length?renderPmTags(r.pms):'<span class="dt-pm-placeholder">选择产品经理</span>'}</div>
        <div class="dt-pm-dropdown">${PM_OPTIONS.map(pm=>`<label class="dt-pm-option"><input type="checkbox" value="${pm}"${r.pms.includes(pm)?' checked':''}> ${pm}</label>`).join('')}</div>
      </div>
      <div><input class="dt-input fill-input-hours" type="number" value="${r.hours}" placeholder="0.00" step="0.01" min="0.01" max="200"></div><div><button class="dt-btn-danger-text btn-fill-del" data-row-idx="${i}" style="font-size:16px">×</button></div></div>`).join('');

    this.root.innerHTML=`<div class="dt-fill-page"><div class="dt-fill-card" style="max-width:none;margin:0 100px">
      <div class="dt-fill-header"><div class="dt-fill-title">${task?task.title:'工作内容提交'}</div><div class="dt-fill-subtitle">【${p?ROLE_MAP[p.role]:''}】${p?p.name:''} 工作内容填写</div></div>
      <div class="dt-fill-body">
        <div class="dt-form-item"><label class="dt-form-label">📋 一键识别需求（粘贴文本自动拆解）</label><textarea class="dt-input" id="auto-parse-text" style="height:80px;resize:vertical" placeholder="示例：V4.633.0 用户中心改版 5h&#10;V4.634.0 支付系统升级 2天"></textarea><button class="dt-btn dt-btn-primary dt-btn-sm" style="margin-top:8px" id="btn-parse">一键识别并填入</button></div>
        <hr class="dt-divider" />
        <div style="display:grid;grid-template-columns:40px 2fr 1fr 1.5fr 100px 40px;gap:12px;padding:8px 0;border-bottom:1px solid var(--color-border);font-size:13px;color:var(--color-text-3);font-weight:500"><div>序号</div><div>需求标题</div><div>版本号</div><div>需求产品人员</div><div>工时(h)</div><div></div></div>
        <div id="fill-rows">${renderRows()}</div>
        <div style="margin-top:12px"><button class="dt-btn dt-btn-outline dt-btn-sm" id="btn-add-fill">+ 新增需求行</button></div>
      </div>
      <div class="dt-fill-footer"><span style="font-size:13px;color:var(--color-text-3)" id="fill-count">共 ${fillRows.length} 条记录</span><div style="display:flex;gap:12px"><button class="dt-btn dt-btn-outline">暂存草稿</button><button class="dt-btn dt-btn-primary" id="btn-submit-fill">提交数据</button></div></div>
    </div></div>`;

    const refreshFill=()=>{
      document.getElementById('fill-rows').innerHTML=renderRows();
      document.getElementById('fill-count').textContent=`共 ${fillRows.length} 条记录`;
      this._bindFillActions();
    };

    this._bindFillActions=()=>{
      // 多选下拉交互
      document.querySelectorAll('.dt-pm-trigger').forEach(trigger=>{
        trigger.addEventListener('click',e=>{
          e.stopPropagation();
          const sel=trigger.closest('.dt-pm-selector');
          document.querySelectorAll('.dt-pm-selector.open').forEach(s=>{if(s!==sel)s.classList.remove('open');});
          sel.classList.toggle('open');
        });
      });
      document.querySelectorAll('.dt-pm-dropdown input[type="checkbox"]').forEach(cb=>{
        cb.addEventListener('change',()=>{
          const sel=cb.closest('.dt-pm-selector');
          const rowIdx=parseInt(sel.dataset.rowIdx);
          const checked=[...sel.querySelectorAll('input:checked')].map(c=>c.value);
          fillRows[rowIdx].pms=checked;
          sel.querySelector('.dt-pm-trigger').innerHTML=checked.length?renderPmTags(checked):'<span class="dt-pm-placeholder">选择产品经理</span>';
        });
      });
      // 删除行
      document.querySelectorAll('.btn-fill-del').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=parseInt(btn.dataset.rowIdx);
          fillRows.splice(idx,1);
          refreshFill();
        });
      });
    };

    // 关闭面板
    document.addEventListener('click',()=>{document.querySelectorAll('.dt-pm-selector.open').forEach(s=>s.classList.remove('open'));});

    document.getElementById('btn-submit-fill')?.addEventListener('click',()=>showToast('数据已提交成功'));
    document.getElementById('btn-add-fill')?.addEventListener('click',()=>{
      fillRows.push({idx:fillRows.length+1,title:'',version:'',pms:[],hours:''});
      refreshFill();
    });
    document.getElementById('btn-parse')?.addEventListener('click',()=>{
      const text=document.getElementById('auto-parse-text').value.trim();
      if(!text){showToast('请先粘贴文本内容');return;}
      const parsed=parseRequirementText(text);
      parsed.forEach(p=>{fillRows.push({idx:fillRows.length+1,title:p.title,version:p.version,pms:p.pms||[],hours:p.hours||''});});
      refreshFill();
      showToast(`已识别 ${parsed.length} 条需求`);
    });

    this._bindFillActions();
  },

  /* ===== 新建收集弹窗 ===== */
  openCreateTaskModal(){
    const now=new Date(),lm=new Date(now);lm.setDate(now.getDate()-now.getDay()-6);const ls=new Date(lm);ls.setDate(lm.getDate()+6);
    const wn=getWeekNum(lm),at=`${fmtDate(lm)}-${fmtDate(ls)}，本年度第${wn}周工作统计`;
    this.modalContent.innerHTML=`<div class="dt-modal-header"><div class="dt-modal-title">新建研发工作收集</div><button class="dt-close" id="mc">×</button></div>
      <div class="dt-modal-body"><div class="dt-form-area"><div class="dt-form-item"><label class="dt-form-label">时间维度</label><select class="dt-select" id="cd">${TIME_DIMS.map(d=>`<option value="${d.value}"${d.value==='week'?' selected':''}>${d.label}</option>`).join('')}</select></div><div class="dt-form-item"><label class="dt-form-label">参考日期</label><input type="date" class="dt-input" id="cr" value="${now.toISOString().split('T')[0]}"></div><div class="dt-form-item"><label class="dt-form-label">任务标题（自动生成）</label><input type="text" class="dt-input" id="ct" value="${at}" readonly style="background:var(--color-bg-2)"></div>
        <div class="dt-section-title" style="margin-top:16px">快捷选择</div><div class="dt-shortcut-list"><button class="dt-shortcut-item active">上周（第${wn}周）</button><button class="dt-shortcut-item">本周（第${wn+1}周）</button><button class="dt-shortcut-item">上月</button></div></div>
        <div class="dt-calendar-area">${renderCalendar(now.getFullYear(),now.getMonth(),lm,ls)}</div></div>
      <div class="dt-modal-footer"><button class="dt-btn dt-btn-outline" id="cc">取消</button><button class="dt-btn dt-btn-primary" id="cf">确认创建</button></div>`;
    this.modalOverlay.classList.add('active');
    document.getElementById('mc').addEventListener('click',()=>this.closeModal());
    document.getElementById('cc').addEventListener('click',()=>this.closeModal());
    document.getElementById('cf').addEventListener('click',()=>{
      const title=document.getElementById('ct').value,dim=document.getElementById('cd').value;
      const tasks=Store.getTasks();tasks.unshift({id:uid(),title,timeDimension:dim,startDate:lm.toISOString().split('T')[0],endDate:ls.toISOString().split('T')[0],weekNumber:wn,year:now.getFullYear(),status:'active',createdAt:now.toISOString().split('T')[0]});
      Store.saveTasks(tasks);this.closeModal();this.renderTasks();showToast('收集任务创建成功');
    });
  }
};

document.addEventListener('DOMContentLoaded',()=>App.init());
