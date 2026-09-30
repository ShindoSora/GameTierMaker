// Runs actual React hooks against controlled network/timer boundaries.
// No application server, user data, or third-party credentials are used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const Renderer = require('react-test-renderer');
const { act } = Renderer;
const root = path.resolve(__dirname, '../../frontend');
const Babel = require(path.join(root, 'vendor/babel.min.js'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}
function environment(overrides = {}) {
  const listeners = new Map();
  const document = {
    activeElement: { focus() {} }, contains: () => true,
    documentElement: { setAttribute() {}, style: {setProperty() {}, removeProperty() {}} },
    querySelector: () => ({ content: 'isolated-test-bootstrap', remove() {} }),
  };
  const context = vm.createContext({
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    AbortController, Headers, FormData, URL, Blob, EventSource: class {},
    document, localStorage: storage(), sessionStorage: storage(),
    fetch: async () => ({ok: true}),
    ...overrides,
  });
  context.window = context;
  context.location = { origin: 'http://127.0.0.1:18000', reload() {} };
  context.addEventListener = (name, fn) => listeners.set(name, fn);
  context.removeEventListener = (name, fn) => {
    if (listeners.get(name) === fn) listeners.delete(name);
  };
  context.GameTierI18n = {t: key => key, getLocale: () => 'zh-CN', setLocale() {}, getErrorMessage: (e, fallback) => fallback};
  context.GameTierApp = { fetchAPI: async () => ({}), showToast() {}, localSessionReady: Promise.resolve(), API: '/api' };
  return { context, app: context.GameTierApp, listeners,
    load(file) { vm.runInContext(Babel.transform(read('src/' + file), {presets:['react'], filename:file}).code, context, {filename:file}); },
  };
}
function mount(hook, props = {}) {
  let current, renderer;
  function Probe(input) { current = hook(input); return null; }
  act(() => { renderer = Renderer.create(React.createElement(Probe, props)); });
  return {
    get value() { return current; },
    update(next) { act(() => renderer.update(React.createElement(Probe, next))); },
    unmount() { act(() => renderer.unmount()); },
  };
}

test('library groups keep source colors after reorder and prefix account names in both views', () => {
  const env = environment();
  env.load('features/library/LibraryGroup.jsx');
  const entries = [
    {id:'default_upload', name:'搜索结果', color:'#A78BFA', title:'library.groups.searchResults'},
    {id:'local_upload', name:'已上传图片', color:'#F5B942', title:'library.groups.uploadedImages'},
    {id:'psn_import_123', name:'玩家', color:'#00439C', title:'PS:玩家'},
    {id:'xbox:123', name:'玩家', color:'#107C10', title:'Xbox:玩家'},
    {id:'nintendo:123', name:'玩家', color:'#E60012', title:'Nintendo:玩家'},
    {id:'steam_import_123', name:'玩家', color:'#66C0F4', title:'Steam:玩家'},
    {id:'custom', name:'PS:自定义', color:'#94A3B8', title:'PS:自定义'},
  ];
  for (const group of [...entries].reverse()) {
    for (const expandedView of [false, true]) {
      let renderer;
      act(() => { renderer = Renderer.create(React.createElement(env.app.LibraryGroup, {
        group: {...group, image_ids:[]}, expandedView,
      })); });
      const root = renderer.toJSON();
      assert.equal(root.props.style['--group-accent'], group.color);
      assert.ok(JSON.stringify(root).includes(group.title));
      act(() => renderer.unmount());
    }
  }
  assert.equal(env.app.getLibraryGroupName({id:'psn_import_123',name:'PSN: 玩家'}),'PS:玩家');
  assert.equal(env.app.getLibraryGroupName({id:'psn_import_123',name:'PS:玩家'}),'PS:玩家');
  assert.equal(env.app.getLibraryGroupName({id:'xbox:123456789',name:'Xbox 12345678'}),'Xbox:12345678');
  assert.equal(env.app.getLibraryGroupName({id:'nintendo:123456789',name:''}),'Nintendo:12345678');
});

test('HTML manifest loads every module in dependency order and preserves bootstrap', async () => {
  const html = read('index.html');
  assert.match(html, /content="__GTM_SESSION_BOOTSTRAP__"/);
  assert.doesNotMatch(html, /<style>|<script[^>]*>\s*(?:const|function|let)\b/);
  const env = environment();
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^"]*)?"[^>]*>/g)].map(m => m[1]);
  assert.equal(new Set(scripts).size, scripts.length);
  for (const url of scripts) {
    assert.ok(fs.existsSync(path.join(root, url)), url);
    if (!url.startsWith('/src/')) continue;
    const file = url.slice(5);
    const ast = Babel.packages.parser.parse(read(url), {plugins:['jsx']});
    Babel.packages.traverse.default(ast, {
      VariableDeclarator(p) {
        const init = p.node.init;
        if (init?.type !== 'MemberExpression' || init.object.name !== 'window' || init.property.name !== 'GameTierApp') return;
        for (const prop of p.node.id.properties || []) {
          assert.notEqual(env.context.GameTierApp[prop.key.name], undefined, `${file}: missing dependency ${prop.key.name}`);
        }
      },
    });
    if (file !== 'main.jsx') env.load(file);
  }
  await env.context.GameTierApp.localSessionReady;
  assert.equal(typeof env.context.GameTierApp.App, 'function');
  const scriptFiles = fs.readdirSync(path.join(root,'src'), {recursive:true})
    .filter(f => /\.(jsx?|js)$/.test(f));
  assert.equal(scripts.filter(f=>f.startsWith('/src/')).length, scriptFiles.length);
});

test('template snapshot race cannot overwrite the selected template; switches serialize', async () => {
  const env = environment();
  const slowA = deferred(), writes = [], firstSwitch = deferred();
  let aReads = 0;
  env.app.fetchAPI = async (url, options) => {
    if (url === '/project/status') return {};
    if (url === '/templates') return [{id:'A',is_current:true},{id:'B'}];
    if (url === '/templates/A/snapshot') {
      if (++aReads === 2) return slowA.promise;
      return {tiers:[{id:'A-row'}],template:{name:'A'}};
    }
    if (url === '/templates/B/snapshot') return {tiers:[{id:'B-row'}],template:{name:'B'}};
    if (url.endsWith('/switch')) {
      writes.push(url);
      if (writes.length === 1) return firstSwitch.promise;
      return {};
    }
    throw Error('Unexpected '+url);
  };
  env.load('features/templates/useTemplates.js');
  const h = mount(env.app.useTemplates, {setLoading() {}, confirmAction:async()=>true});
  await act(async () => { await h.value.loadData(); });
  let stale, toB, toA;
  act(() => { stale = h.value.loadCurrentTemplate('A'); });
  act(() => { toB = h.value.switchTemplate('B'); });
  await act(tick);
  act(() => { toA = h.value.switchTemplate('A'); });
  assert.deepEqual(writes, ['/templates/B/switch']);
  await act(async () => { firstSwitch.resolve({}); await Promise.all([toB,toA]); });
  await act(async () => { slowA.resolve({tiers:[{id:'STALE'}]}); await stale; });
  assert.deepEqual(writes, ['/templates/B/switch','/templates/A/switch']);
  assert.equal(h.value.currentId, 'A');
  assert.equal(h.value.tiers[0].id, 'A-row');
  h.unmount();
});

test('recovery cancellation never sends project/reset', async () => {
  const env = environment(), calls=[];
  env.app.fetchAPI = async url => {calls.push(url); return {status:'recovery_required'};};
  env.load('features/templates/useTemplates.js');
  const h=mount(env.app.useTemplates,{setLoading(){},confirmAction:async()=>false});
  await act(async()=>{await h.value.loadData();});
  assert.deepEqual(calls,['/project/status']);
  h.unmount();
});

test('search ignores out-of-order results, closing aborts, unmount aborts', async () => {
  const env=environment(), requests=[];
  env.app.fetchAPI=(url,options)=>{const d=deferred(); requests.push({...d,options}); return d.promise;};
  env.load('features/search/useGameSearch.js');
  const h=mount(env.app.useGameSearch,{currentId:'A',setLoading(){},loadCurrentTemplate:async()=>{}});
  act(()=>h.value.setSearchQuery('old')); let first,second,third;
  act(()=>{first=h.value.handleSearch();});
  act(()=>h.value.setSearchQuery('new'));
  act(()=>{second=h.value.handleSearch();});
  assert.equal(requests[0].options.signal.aborted,true);
  await act(async()=>{requests[1].resolve({results:['new']});await second;});
  await act(async()=>{requests[0].resolve({results:['old']});await first;});
  assert.equal(h.value.searchResults.results[0],'new');
  act(()=>{third=h.value.handleSearch(); h.value.handleCloseSearchResults();});
  assert.equal(requests[2].options.signal.aborted,true);
  await act(async()=>{requests[2].resolve({results:['late']});await third;});
  assert.equal(h.value.searchResults,null);
  let last; act(()=>{last=h.value.handleSearch();});
  h.unmount(); assert.equal(requests[3].options.signal.aborted,true);
  requests[3].resolve({results:[]}); await last;
});

test('cover double-click submits once with captured template and source asset identity', async()=>{
  const env=environment(), request=deferred(), calls=[], refreshed=[];
  env.app.fetchAPI=(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return request.promise;};
  env.load('features/search/useGameSearch.js');
  const props={currentId:'A',setLoading(){},loadCurrentTemplate:async id=>refreshed.push(id)};
  const h=mount(env.app.useGameSearch,props);
  const game={name:'Fixture',cover:{url:'https://example.invalid/cover.png'},source:'steamgriddb',source_game_id:'42',asset_id:'99'};
  let a,b; act(()=>{a=h.value.handleSelectSearchResult(game);b=h.value.handleSelectSearchResult(game);});
  h.update({...props,currentId:'B'});
  await act(async()=>{request.resolve({});await Promise.all([a,b]);});
  assert.equal(calls.length,1); assert.match(calls[0].url,/template_id=A/);
  assert.equal(calls[0].body.asset_id,'99'); assert.equal(calls[0].body.game_id,'42');
  assert.deepEqual(refreshed,['A']); h.unmount();
});

test('dialog queue resolves once in order and unmount settles active and queued input', async()=>{
  const env=environment();env.load('hooks/useDialogs.js');const h=mount(env.app.useDialogs);
  let a,b,c,d;
  act(()=>{a=h.value.confirmAction('one');b=h.value.confirmAction('two');});
  assert.equal(h.value.confirmRequest.message,'one');
  await act(async()=>{h.value.resolveConfirm(true);await new Promise(r=>setTimeout(r,5));});
  assert.equal(await a,true);assert.equal(h.value.confirmRequest.message,'two');
  act(()=>{c=h.value.inputDialog({message:'input'});d=h.value.inputDialog({message:'queued'});});
  h.unmount();assert.equal(await b,false);assert.equal(await c,null);assert.equal(await d,null);
});

test('busy state stays active until all concurrent operations finish',()=>{
  const env=environment();env.load('hooks/useBusy.js');const h=mount(env.app.useBusy);
  act(()=>{h.value.setLoading(true);h.value.setLoading(true);});
  act(()=>h.value.setLoading(false));assert.equal(h.value.loading,true);
  act(()=>h.value.setLoading(false));assert.equal(h.value.loading,false);
  act(()=>h.value.setLoading(false));assert.equal(h.value.loading,false);h.unmount();
});

test('desktop preferences are not saved before hydration and flush before refresh',async()=>{
  const timers=new Map();let id=0;const calls=[],server=deferred();
  const env=environment({setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)});
  env.context.pywebview={api:{}};
  env.app.fetchAPI=async(url,options={})=>{
    calls.push({url,method:options.method,body:options.body&&JSON.parse(options.body)});
    if(url==='/health')return {runtime_mode:'desktop'};
    if(options.method==='PUT')return {};
    return server.promise;
  };
  env.load('core/preferences.js');env.load('hooks/useUiPreferences.js');const h=mount(env.app.useUiPreferences);
  let loading;act(()=>{loading=h.value.loadDesktopUiPreferences();});await act(tick);
  act(()=>h.value.setLibraryWidth(330));assert.equal(calls.filter(c=>c.method==='PUT').length,0);
  await act(async()=>{server.resolve({library_open:false,library_width:420,settings_open:true,settings_width:700,settings_active_section:'download'});await loading;});
  assert.equal(h.value.libraryWidth,420);assert.equal(h.value.showSettings,true);
  act(()=>h.value.setLibraryWidth(450));
  let reloaded=false;env.context.location.reload=()=>{reloaded=true;};
  await act(async()=>{h.value.handleGlobalRefresh();await tick();});
  const writes=calls.filter(c=>c.method==='PUT');assert.equal(writes.length,1);assert.equal(writes[0].body.library_width,450);
  for(const fn of [...timers.values()])fn();
  assert.equal(reloaded,true);h.unmount();
});

test('settings preserve untouched hidden secrets and report partial save failures',async()=>{
  const env=environment(),writes=[],notices=[];
  env.app.showToast=(message,type)=>notices.push({message,type});
  env.app.fetchAPI=async(url,options)=>{
    if(!options)return {client_id:'old',bangumi_user_agent:'old-agent',configured_secrets:{client_secret:true,bangumi_token:true,steamgriddb_api_key:true}};
    const body=JSON.parse(options.body);writes.push({url,body});
    if(url==='/settings/bangumi')throw Error('fixture failure');
    return {};
  };
  env.load('core/display.js');env.load('features/settings/useSettings.js');
  const h=mount(env.app.useSettings,{loadDownloadSettings(){},setShowSettings(){},loadSteamAccounts(){},loadPsnAccounts(){}});
  await act(async()=>{await h.value.handleOpenSettings();});
  act(()=>{h.value.setIgdbClientId('changed');h.value.setBangumiUserAgent('changed-agent');});
  await act(async()=>{await h.value.handleSaveAllSettings();});
  assert.equal(writes.find(c=>c.url==='/settings/igdb').body.client_secret,null);
  assert.equal(writes.find(c=>c.url==='/settings/bangumi').body.bangumi_token,null);
  assert.equal(notices.filter(c=>c.type==='error').length,1);
  writes.length=0;
  await act(async()=>{await h.value.handleSaveAllSettings();});
  assert.deepEqual(writes.map(c=>c.url),['/settings/bangumi']);h.unmount();
});

test('live logs deduplicate entries and close their connection on unmount',async()=>{
  const sources=[];
  class FakeSource {constructor(){this.events={};sources.push(this);}addEventListener(k,fn){this.events[k]=fn;}close(){this.closed=true;}}
  const env=environment({EventSource:FakeSource});
  env.app.fetchAPI=async()=>({session_id:'test',entries:[{id:1,level:'INFO',message:'one'}]});
  env.load('features/logs/useLiveLogs.js');const h=mount(env.app.useLiveLogs,{confirmAction:async()=>true});
  await act(tick);assert.equal(sources.length,1);
  act(()=>{sources[0].events.log({data:JSON.stringify({id:1,level:'INFO'})});sources[0].events.log({data:JSON.stringify({id:2,level:'ERROR'})});});
  assert.equal(h.value.logEntries.length,2);assert.equal(h.value.unreadLogErrors,1);
  h.unmount();assert.equal(sources[0].closed,true);assert.equal(env.listeners.size,0);
});

test('backfill serializes sources and refreshes the current template',async()=>{
  const env=environment({setTimeout:()=>1,clearTimeout(){}}),first=deferred(),calls=[],refreshed=[];
  env.app.fetchAPI=(url)=>{calls.push(url);return calls.length===1?first.promise:Promise.resolve({ok:1,fail:0,remaining:0});};
  env.load('features/images/useImageBackfill.js');let active='A';
  const h=mount(env.app.useImageBackfill,{getCurrentTemplate:()=>({currentId:active,loadCurrentTemplate:async id=>refreshed.push(id)})});
  let job;act(()=>{job=h.value.runBackfill('steam');h.value.runBackfill('psn');});
  assert.equal(calls.length,1);active='B';
  await act(async()=>{first.resolve({ok:1,fail:0,remaining:0});await job;});
  assert.deepEqual(calls,['/settings/images/backfill?source=steam','/settings/images/backfill?source=psn']);assert.deepEqual(refreshed,['B']);h.unmount();
});

test('Steam callback accepts only the expected same-origin operation and deduplicates completion',async()=>{
  const env=environment(),refreshes=[],backfills=[],calls=[];
  env.app.fetchAPI=async url=>{calls.push(url);return {accounts:{}};};
  env.load('features/platforms/useSteamAccount.js');
  const h=mount(env.app.useSteamAccount,{
    getCurrentTemplate:()=>({currentId:'active',loadCurrentTemplate:async id=>refreshes.push(id)}),
    runBackfill:source=>backfills.push(source),currentId:'initial',setSettingsOperation(){},
    refreshSelectedTemplate:async()=>{},confirmAction:async()=>true,
  });
  env.context.sessionStorage.setItem('steam-import-operation','expected');
  const message=env.listeners.get('message');
  await message({origin:'https://untrusted.invalid',data:{type:'steam-import-done',operation_id:'expected'}});
  await message({origin:env.context.location.origin,data:{type:'steam-import-done',operation_id:'stale'}});
  assert.equal(calls.length,0);
  const event={origin:env.context.location.origin,data:{type:'steam-import-done',operation_id:'expected',total:3}};
  await act(async()=>{await message(event);await message(event);});
  assert.deepEqual(refreshes,['active']);assert.deepEqual(backfills,['steam']);
  assert.equal(calls.length,1);h.unmount();assert.equal(env.listeners.size,0);
});

test('backfill unmount aborts the active request and does not start queued work',async()=>{
  const env=environment(),pending=deferred(),requests=[];
  env.app.fetchAPI=(url,options)=>{requests.push({url,options});return pending.promise;};
  env.load('features/images/useImageBackfill.js');
  const h=mount(env.app.useImageBackfill,{getCurrentTemplate:()=>{throw Error('must not refresh after unmount');}});
  let job;act(()=>{job=h.value.runBackfill('steam');h.value.runBackfill('psn');});
  h.unmount();assert.equal(requests[0].options.signal.aborted,true);
  pending.resolve({ok:1,fail:0,remaining:1});await job;assert.equal(requests.length,1);
});
