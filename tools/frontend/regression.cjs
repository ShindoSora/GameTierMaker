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
  env.load('core/display.js');
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

test('tier cards update their theme and preserve image drop, row reorder, and rename callbacks', () => {
  const env = environment(), drops = [], reorders = [], renames = [];
  Object.assign(env.app, {
    DraggableImage: () => React.createElement('div', {className:'drag-image'}),
    storeDragEvent() {}, clearDragEvent() {}, calculateInsertIndex: () => 1, dragState: {},
  });
  env.load('components/Controls.jsx');
  env.load('features/tierBoard/TierRow.jsx');
  const props = {
    tier:{id:'row',label:'S',color:'#FF7F7F'}, images:['one','two'], index:0,
    onDrop:(...args)=>drops.push(args), onRowReorder:(...args)=>reorders.push(args),
    onRename:(...args)=>renames.push(args),
  };
  let renderer;
  act(() => { renderer = Renderer.create(React.createElement(env.app.TierRow, props)); });
  const find = name => renderer.root.findAllByType('div').find(node => node.props.className?.split(' ').includes(name));
  assert.equal(find('tier-row-container').props.style['--tier-color'], '#FF7F7F');
  act(() => renderer.update(React.createElement(env.app.TierRow, {...props,tier:{...props.tier,color:'#0070D1'}})));
  assert.equal(find('tier-row-container').props.style['--tier-color'], '#0070D1');
  const imageEvent = {preventDefault(){},stopPropagation(){},dataTransfer:{getData:()=> 'one'}};
  act(() => find('tier-images').props.onDragOver(imageEvent));
  assert.ok(find('tier-row-container').props.className.includes('image-drag-over'));
  act(() => find('tier-images').props.onDrop(imageEvent));
  assert.deepEqual(drops, [['one','row',1]]);
  assert.equal(find('tier-row-container').props.className.includes('image-drag-over'), false);
  act(() => find('tier-row-container').props.onDrop({
    ...imageEvent, clientY:10, dataTransfer:{getData:()=> '2'},
    currentTarget:{getBoundingClientRect:()=>({top:0,height:124})},
  }));
  assert.deepEqual(reorders, [[2,0]]);
  act(() => find('tier-header').props.onClick());
  act(() => renderer.root.findByType('input').props.onChange({target:{value:'最爱'}}));
  act(() => renderer.root.findByType('input').props.onKeyDown({key:'Enter'}));
  assert.deepEqual(renames, [['row','最爱']]);
  assert.equal(env.app.getTierTheme('#000')['--tier-label-text'], '#ffffff');
  assert.equal(env.app.getTierTheme('#fff')['--tier-label-text'], '#171722');
  assert.equal(env.app.getTierTheme('')['--tier-color'], '#808080');
  act(() => renderer.unmount());
});

test('library island opens from the button, reverses safely, and respects restored state and reduced motion', () => {
  const motions=[];let reduced=false,renderer,setOpen,setWidth,motionChange;
  const env=environment({getComputedStyle:node=>node.computed});
  const media={get matches(){return reduced;},addEventListener(_,fn){motionChange=fn;},removeEventListener(){motionChange=null;}};
  env.context.matchMedia=()=>media;
  env.app.SearchResults=()=>null;env.app.LibraryGroup=()=>null;
  env.load('core/display.js');
  env.load('features/library/LibraryPanel.jsx');
  const defaults={transform:'none',borderRadius:'32px',opacity:'1'};
  const panel={computed:{...defaults},getBoundingClientRect:()=>({left:48,top:8,width:420,height:704}),contains:()=>false};
  const content={computed:{opacity:'1'}};
  const button={computed:{borderRadius:'12px'},getBoundingClientRect:()=>({left:7,top:20,width:34,height:34}),focus(){}};
  for(const node of [panel,content])node.animate=(frames,options)=>{
    const animation={frames,options,playState:'running',cancel(){this.cancelled=true;this.playState='idle';node.computed=node===panel?{...defaults}:{opacity:'1'};}};
    motions.push(animation);return animation;
  };
  function Demo(){const [open,updateOpen]=React.useState(false),[width,updateWidth]=React.useState(420);setOpen=updateOpen;setWidth=updateWidth;
    return React.createElement(env.app.LibraryPanel,{
      preferencesModel:{libraryOpen:open,setLibraryOpen:updateOpen,libraryWidth:width,setLibraryWidth:updateWidth},
      searchModel:{searchQuery:'',searchMinimized:false},imagesModel:{fileInputRef:{current:null}},
      libraryModel:{libraryGroupsRef:{current:null}},tierBoardModel:{},templatesModel:{libraryGroups:[],imagesMeta:{}},
    });
  }
  act(()=>{renderer=Renderer.create(React.createElement(Demo),{createNodeMock:element=>{
    if(element.type==='button'&&element.props.className?.includes('sidebar-toggle'))return button;
    if(element.props.className?.split(' ').includes('library-panel'))return panel;
    if(element.props.className==='library-panel-content')return content;
    return {};
  }});});
  const findPanel=()=>renderer.root.findAllByType('div').find(n=>n.props['data-library-state']);
  const toggle=()=>renderer.root.findAllByType('button').find(n=>n.props.className?.includes('sidebar-toggle')).props.onClick();
  assert.equal(motions.length,0);assert.equal(findPanel().props['data-library-state'],'closed');
  act(toggle);
  assert.equal(findPanel().props['data-library-state'],'opening');
  assert.match(motions[0].frames[0].transform,/translate\(-41px, 12px\) scale/);
  assert.equal(motions[0].frames[0].opacity,1);
  assert.equal(motions[0].options.easing,'cubic-bezier(0.18, 1.18, 0.35, 1)');
  assert.equal(findPanel().props.inert,'');
  const staleFinish=motions[0].onfinish;
  panel.computed={transform:'matrix(0.6, 0, 0, 0.4, -20, 8)',borderRadius:'40px',opacity:'0.8'};
  content.computed.opacity='0.6';
  act(toggle);
  assert.equal(motions[0].cancelled,true);
  assert.equal(motions[2].frames[0].transform,'matrix(0.6, 0, 0, 0.4, -20, 8)');
  act(()=>staleFinish());assert.equal(findPanel().props['data-library-state'],'closing');
  act(()=>{motions[2].playState='finished';motions[2].onfinish();});
  assert.equal(findPanel().props['data-library-state'],'closed');
  assert.equal(motions[2].cancelled,true);
  act(()=>setOpen(true));assert.equal(findPanel().props['data-library-state'],'open');assert.equal(motions.length,4);
  act(()=>setWidth(480));assert.equal(motions.length,4);
  act(()=>setOpen(false));reduced=true;act(toggle);
  assert.equal(findPanel().props['data-library-state'],'open');assert.equal(motions.length,4);
  reduced=false;act(toggle);assert.equal(findPanel().props['data-library-state'],'closing');
  reduced=true;act(()=>motionChange());assert.equal(findPanel().props['data-library-state'],'closed');
  assert.equal(motions[4].cancelled,true);
  act(()=>renderer.unmount());
  assert.equal(motionChange,null);
});

test('group island uses the clicked card geometry and can close during opening without a stale completion', () => {
  const motions=[],completed=[];let renderer,reduced=false;
  const env=environment({getComputedStyle:node=>node.computed});
  env.context.matchMedia=()=>({matches:reduced,addEventListener(){},removeEventListener(){}});
  env.load('core/display.js');env.load('features/library/LibraryGroup.jsx');
  const overlay={computed:{transform:'none',borderRadius:'24px',opacity:'1'},
    getBoundingClientRect:()=>({left:60,top:120,width:400,height:540}),
    parentElement:{getBoundingClientRect:()=>({left:50,top:114})}};
  const content={computed:{opacity:'1'}};
  const list={computed:{opacity:'0'}};
  for(const node of [overlay,content,list])node.animate=(frames,options)=>{
    const motion={frames,options,playState:'running',cancel(){this.cancelled=true;this.playState='idle';}};
    motions.push(motion);return motion;
  };
  const props={group:{id:'local_upload',image_ids:[]},expandedView:true,
    originRect:{left:10,top:52,width:400,height:36,radius:12},sourceListRef:{current:list},onCloseComplete:id=>completed.push(id)};
  act(()=>{renderer=Renderer.create(React.createElement(env.app.LibraryGroup,props),{
    createNodeMock:el=>el.props.className?.includes('group-island-overlay')?overlay:content});});
  assert.equal(motions[0].frames[0].transform,'translate(0px, 46px) scale(1, 0.06666666666666667)');
  assert.equal(motions[0].frames[0].borderRadius,'12px / 180px');
  assert.equal(motions[0].options.duration,480);
  assert.equal(motions[2].frames.at(-1).opacity,0);
  const stale=motions[0].onfinish;
  overlay.computed.transform='matrix(1, 0, 0, 0.65, 0, 16)';content.computed.opacity='0.4';
  act(()=>renderer.update(React.createElement(env.app.LibraryGroup,{...props,closing:true})));
  assert.equal(motions[0].cancelled,true);
  assert.equal(motions[3].frames[0].transform,overlay.computed.transform);
  assert.equal(motions[3].frames.at(-1).opacity,0);
  assert.equal(motions[4].frames[0].opacity,0.4);
  assert.equal(motions[5].frames.at(-1).opacity,1);
  act(()=>stale());assert.equal(completed.length,0);
  assert.equal(renderer.toJSON().props['data-group-state'],'closing');
  act(()=>{motions[3].playState='finished';motions[3].onfinish();});
  assert.deepEqual(completed,['local_upload']);
  act(()=>renderer.unmount());assert.ok(motions.every(m=>m.cancelled));
  reduced=true;
  act(()=>{renderer=Renderer.create(React.createElement(env.app.LibraryGroup,{...props,closing:true}),{
    createNodeMock:el=>el.props.className?.includes('group-island-overlay')?overlay:content});});
  assert.equal(motions.length,6);assert.equal(completed.length,2);
  act(()=>renderer.unmount());
});

test('group close retains active content until completion and remeasures the retained card after resize', () => {
  const env=environment({getComputedStyle:()=>({borderRadius:'12px'})});
  env.load('features/library/useLibraryActions.js');
  const groups=[{id:'a',image_ids:[]},{id:'b',image_ids:[]}];
  const h=mount(env.app.useLibraryActions,{libraryGroups:groups});
  h.value.libraryGroupsRef.current={getBoundingClientRect:()=>({left:50,top:114})};
  let width=400;
  const card={isConnected:true,getBoundingClientRect:()=>({left:60,top:260,width,height:36})};
  const event={currentTarget:{closest:()=>card}};
  act(()=>h.value.handleOpenLibraryGroup(event,groups[0]));
  assert.equal(h.value.activeLibraryGroup.originRect.top,146);
  width=460;
  act(()=>h.value.handleCloseLibraryGroup());
  assert.equal(h.value.activeGroupData.id,'a');assert.equal(h.value.closingLibraryGroup,true);
  assert.equal(h.value.activeLibraryGroup.originRect.width,460);
  act(()=>h.value.handleLibraryGroupCloseComplete('b'));assert.equal(h.value.activeGroupData.id,'a');
  act(()=>h.value.handleLibraryGroupCloseComplete('a'));assert.equal(h.value.activeGroupData,null);
  act(()=>{h.value.handleOpenLibraryGroup(event,groups[1]);h.value.handleLibraryGroupCloseComplete('a');});
  assert.equal(h.value.activeGroupData.id,'b');assert.equal(h.value.closingLibraryGroup,false);
  h.unmount();
});

test('settings and log islands retain closing panels, reverse from current geometry, and use a connected fallback button', () => {
  let reduced=false,motionChange;const animations=[];
  const env=environment({getComputedStyle:node=>node.computed});
  env.context.matchMedia=()=>({get matches(){return reduced;},addEventListener(_,fn){motionChange=fn;},removeEventListener(){}});
  env.load('core/display.js');env.load('hooks/useIslandPanel.js');
  const anchor={isConnected:true,computed:{borderRadius:'12px'},getBoundingClientRect:()=>({left:730,top:16,width:32,height:32}),focus(){}};
  const fallback={...anchor,getBoundingClientRect:()=>({left:770,top:16,width:32,height:32})};
  const panel={computed:{transform:'none',borderRadius:'32px',opacity:'1'},getBoundingClientRect:()=>({left:400,top:8,width:400,height:624}),contains:()=>false};
  const content={computed:{opacity:'1'}},backdrop={computed:{opacity:'1'}};
  for(const node of [panel,content,backdrop])node.animate=(frames,options)=>{
    const animation={frames,options,playState:'running',cancel(){this.cancelled=true;this.playState='idle';}};
    animations.push(animation);return animation;
  };
  const props={open:false,width:400,anchorRef:{current:anchor},fallbackRef:{current:fallback}};
  const h=mount(env.app.useIslandPanel,props);
  Object.assign(h.value.panelRef,{current:panel});Object.assign(h.value.contentRef,{current:content});Object.assign(h.value.backdropRef,{current:backdrop});
  assert.equal(h.value.visible,false);h.update({...props,open:true});
  assert.equal(h.value.phase,'opening');assert.match(animations[0].frames[0].transform,/translate\(330px, 8px\)/);
  const stale=animations[0].onfinish;
  panel.computed.transform='matrix(0.7, 0, 0, 0.5, 90, 4)';content.computed.opacity='0.5';
  h.update(props);assert.equal(h.value.visible,true);assert.equal(h.value.phase,'closing');
  assert.equal(animations[3].frames[0].transform,panel.computed.transform);assert.equal(animations[4].frames[0].opacity,0.5);
  act(()=>stale());assert.equal(h.value.phase,'closing');
  act(()=>{animations[3].playState='finished';animations[3].onfinish();});
  assert.equal(h.value.visible,false);assert.equal(animations[3].cancelled,true);
  anchor.isConnected=false;h.update({...props,open:true});
  assert.match(animations[6].frames[0].transform,/translate\(370px, 8px\)/);
  reduced=true;act(()=>motionChange());assert.equal(h.value.phase,'open');assert.equal(animations[6].cancelled,true);
  h.update(props);assert.equal(h.value.visible,false);assert.equal(animations.length,9);
  h.unmount();
  const restored=mount(env.app.useIslandPanel,{...props,open:true});assert.equal(restored.value.phase,'open');assert.equal(animations.length,9);restored.unmount();
});

test('minimizing search results retains image nodes and scroll container without rendering covers again', () => {
  const env=environment();let renderer,setData,nameReads=0;const selected=[];
  env.app.LibraryGroup=()=>null;
  env.load('core/display.js');env.load('features/search/SearchResults.jsx');env.load('features/library/LibraryPanel.jsx');
  const data={results:Array.from({length:40},(_,i)=>({result_id:String(i),source:'vndb',cover:{url:`https://example.invalid/${i}.jpg`},get name(){nameReads++;return `Game ${i}`;}})),sources:[]};
  function Demo({template='A'}) {
    const [minimized,setMinimized]=React.useState(false),[results,updateData]=React.useState(data);setData=updateData;
    return React.createElement(env.app.LibraryPanel,{
      preferencesModel:{libraryOpen:true,libraryWidth:420},
      searchModel:{searchQuery:'',searchMinimized:minimized,setSearchMinimized:setMinimized,searchResults:results,searchSource:'all',handleSelectSearchResult:game=>selected.push([template,game.result_id]),handleCloseSearchResults:()=>updateData(null)},
      imagesModel:{fileInputRef:{current:null}},libraryModel:{libraryGroupsRef:{current:null}},tierBoardModel:{},templatesModel:{libraryGroups:[],imagesMeta:{}},
    });
  }
  act(()=>{renderer=Renderer.create(React.createElement(Demo,{}));});
  const images=renderer.root.findAllByType('img'),reads=nameReads;
  const panel=renderer.root.findByProps({id:'search-results-panel'});
  assert.equal(images.length,40);assert.equal(images[0].props.loading,'lazy');assert.equal(images[0].props.decoding,'async');
  const button=className=>renderer.root.findAllByType('button').find(n=>n.props.className?.split(' ').includes(className));
  for(let i=0;i<3;i++){
    act(()=>button('library-search-minimize').props.onClick());
    assert.equal(renderer.root.findAllByType(env.app.SearchResults).length,1);
    assert.equal(renderer.root.findAllByType('img')[0],images[0]);
    const overlay=renderer.root.findAllByType('div').find(n=>n.props.className?.split(' ').includes('library-search-overlay'));
    assert.equal(overlay.props['aria-hidden'],true);assert.equal(overlay.props.inert,'');
    act(()=>button('library-search-restore').props.onClick());
    assert.equal(renderer.root.findByProps({id:'search-results-panel'}),panel);
  }
  assert.equal(nameReads,reads);
  act(()=>renderer.update(React.createElement(Demo,{template:'B'})));
  act(()=>renderer.root.findAllByType('div').find(n=>n.props.className==='search-result-card').props.onClick());
  assert.deepEqual(selected,[['B','0']]);assert.equal(nameReads,reads);
  act(()=>setData(null));assert.equal(renderer.root.findAllByType('img').length,0);
  act(()=>renderer.unmount());
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

test('group clear dissolves images and group delete dissolves panel before refreshing', async () => {
  for (const action of ['clear', 'delete']) {
    const env=environment({getComputedStyle:()=>({borderRadius:'12px'})});
    const events=[], confirmation=deferred(), animation=deferred();
    const effect={play:()=>{events.push('animate');return animation.promise;},dispose:()=>events.push('dispose')};
    env.app.prepareGroupImagesDissolve=id=>{events.push('covers:'+id);return effect;};
    env.app.prepareGroupPanelDissolve=async id=>{events.push('panel:'+id);return effect;};
    env.app.fetchAPI=async(url,options)=>events.push(options.method+':'+url);
    env.load('features/library/useLibraryActions.js');
    const h=mount(env.app.useLibraryActions,{currentId:'captured',libraryGroups:[{id:'g',image_ids:['a','b']}],
      confirmAction:()=>confirmation.promise,
      loadCurrentTemplate:async id=>events.push('refresh:'+id),
      refreshSelectedTemplate:async()=>events.push('refresh-current')});
    h.value.libraryGroupsRef.current={getBoundingClientRect:()=>({left:0,top:0})};
    const card={getBoundingClientRect:()=>({left:0,top:0,width:300,height:36})};
    act(()=>h.value.handleOpenLibraryGroup({currentTarget:card},{id:'g'}));
    const invoke=()=>action==='clear'?h.value.handleClearGroup('g'):h.value.handleDeleteGroup('g');
    let operation;act(()=>{operation=invoke();});
    await act(async()=>invoke());
    assert.equal(events.length,0);
    await act(async()=>{confirmation.resolve(true);await tick();});
    assert.deepEqual(events,[action==='clear'?'covers:g':'panel:g',
      `DELETE:/library/groups/g${action==='clear'?'/images':''}?template_id=captured`,'animate']);
    assert.equal(h.value.activeLibraryGroup.id,'g');
    await act(async()=>{animation.resolve();await operation;});
    assert.equal(events[3],action==='clear'?'refresh-current':'refresh:captured');
    assert.equal(events[4],'dispose');
    assert.equal(h.value.activeLibraryGroup?.id,action==='clear'?'g':undefined);
    h.unmount();
  }
});

test('group cancellation and request failure retain content and do not play particles', async () => {
  for(const action of ['clear','delete']) for(const confirmed of [false,true]) {
    const env=environment();let played=false,disposed=false,refreshed=false,errors=0;
    const effect={play:()=>{played=true;},dispose:()=>{disposed=true;}};
    env.app.prepareGroupImagesDissolve=()=>effect;
    env.app.prepareGroupPanelDissolve=async()=>effect;
    env.app.fetchAPI=async()=>{throw new Error('request failed');};
    env.app.showToast=()=>{errors++;};
    env.load('features/library/useLibraryActions.js');
    const h=mount(env.app.useLibraryActions,{currentId:'t',libraryGroups:[],confirmAction:async()=>confirmed,
      loadCurrentTemplate:async()=>{refreshed=true;},refreshSelectedTemplate:async()=>{refreshed=true;}});
    await act(async()=>action==='clear'?h.value.handleClearGroup('g'):h.value.handleDeleteGroup('g'));
    assert.equal(played,false);assert.equal(refreshed,false);
    assert.equal(disposed,confirmed);assert.equal(errors,confirmed?1:0);
    h.unmount();
  }
});

test('image deletion confirms, deletes, animates, then refreshes; cancel and errors never animate', async () => {
  for (const global of [false, true]) {
    const env = environment();
    const order = [], confirmation = deferred(), animation = deferred();
    env.app.prepareImageDissolve = id => {
      order.push('snapshot:' + id);
      return {play: () => {order.push('animate'); return animation.promise;}, dispose: () => order.push('dispose')};
    };
    env.app.fetchAPI = async (url, options) => {order.push(options.method + ':' + url);};
    env.load('features/images/useImageActions.js');
    const h = mount(env.app.useImageActions, {
      currentId:'original-template', confirmAction: () => confirmation.promise,
      loadCurrentTemplate: async id => order.push('refresh:' + id),
      refreshSelectedTemplate: async () => order.push('refresh-global'),
    });
    let deletion;
    act(() => { deletion = h.value.handleDeleteImage('cover', global); });
    await act(async () => h.value.handleDeleteImage('cover', global));
    assert.equal(order.length, 0);
    await act(async () => { confirmation.resolve(true); await tick(); });
    assert.deepEqual(order.slice(0,3), ['snapshot:cover',
      `DELETE:/images/cover?is_global=${global}&template_id=original-template`, 'animate']);
    assert.equal(order.length, 3);
    await act(async () => {animation.resolve(); await deletion;});
    assert.equal(order[3], global ? 'refresh-global' : 'refresh:original-template');
    assert.equal(order[4], 'dispose');
    h.unmount();
  }
  for (const confirmed of [false, true]) {
    const env = environment(); let animated = false, disposed = false, errorShown = false, refreshed = false;
    env.app.prepareImageDissolve = () => ({play:()=>{animated=true;},dispose:()=>{disposed=true;}});
    env.app.fetchAPI = async () => {throw new Error('delete-failed');};
    env.app.showToast = () => {errorShown=true;};
    env.load('features/images/useImageActions.js');
    const h = mount(env.app.useImageActions,{currentId:'t', confirmAction:async()=>confirmed,
      loadCurrentTemplate:async()=>{refreshed=true;}});
    await act(async()=>h.value.handleDeleteImage('cover', false));
    assert.equal(animated,false); assert.equal(refreshed,false);
    assert.equal(errorShown,confirmed); assert.equal(disposed,confirmed);
    h.unmount();
  }
});

test('glass preferences apply immediately and survive remount', () => {
  const env = environment();
  const attrs = {}, styles = {};
  env.context.document.documentElement.setAttribute = (key, value) => { attrs[key] = value; };
  env.context.document.documentElement.style.setProperty = (key, value) => { styles[key] = value; };
  env.load('core/preferences.js');
  env.load('hooks/useUiPreferences.js');
  const first = mount(env.app.useUiPreferences);
  assert.equal(first.value.liquidGlassEnabled, true);
  assert.equal(first.value.liquidGlassTransparency, 25);
  act(() => first.value.setLiquidGlassTransparency(60));
  assert.equal(styles['--liquid-glass-alpha'], '0.4');
  act(() => first.value.setLiquidGlassEnabled(false));
  assert.equal(attrs['data-liquid-glass'], 'off');
  first.unmount();
  const restored = mount(env.app.useUiPreferences);
  assert.equal(restored.value.liquidGlassEnabled, false);
  assert.equal(restored.value.liquidGlassTransparency, 60);
  assert.equal(env.app.normalizeUiPreferences({liquidGlassTransparency:999}).liquidGlassTransparency, 80);
  assert.equal(env.app.normalizeUiPreferences({liquidGlassTransparency:null}).liquidGlassTransparency, 25);
  restored.unmount();
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
  act(()=>{h.value.setLiquidGlassEnabled(false);h.value.setLiquidGlassTransparency(60);});
  act(()=>h.value.setLibraryWidth(450));
  let reloaded=false;env.context.location.reload=()=>{reloaded=true;};
  await act(async()=>{h.value.handleGlobalRefresh();await tick();});
  const writes=calls.filter(c=>c.method==='PUT');assert.equal(writes.length,1);assert.equal(writes[0].body.library_width,450);
  assert.equal(writes[0].body.liquid_glass_enabled,false);
  assert.equal(writes[0].body.liquid_glass_transparency,60);
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
  const sources=[],requests=[];
  class FakeSource {constructor(){this.events={};sources.push(this);}addEventListener(k,fn){this.events[k]=fn;}close(){this.closed=true;}}
  const env=environment({EventSource:FakeSource});
  env.app.fetchAPI=async(url)=>{requests.push(url);return {session_id:'test',entries:[{id:1,level:'INFO',message:'one'}]};};
  env.load('features/logs/useLiveLogs.js');const h=mount(env.app.useLiveLogs,{confirmAction:async()=>true});
  await act(tick);assert.equal(sources.length,1);
  act(()=>{sources[0].events.log({data:JSON.stringify({id:1,level:'INFO'})});sources[0].events.log({data:JSON.stringify({id:2,level:'ERROR'})});});
  assert.equal(h.value.logEntries.length,2);assert.equal(h.value.unreadLogErrors,1);
  act(()=>h.value.setLogSource('console'));
  assert.equal(h.value.logConnection,'unavailable');
  await act(async()=>h.value.handleClearLogs());
  assert.equal(requests.some(url=>url.startsWith('/logs/clear')),false);
  h.unmount();assert.equal(sources[0].closed,true);assert.equal(env.listeners.size,0);
});

test('log tabs have independent cursors, copy/clear scope, and reset on a new server session', async () => {
  const sources=[], calls=[], copied=[];
  class FakeSource {constructor(url){this.url=url;this.events={};sources.push(this);}addEventListener(k,fn){this.events[k]=fn;}close(){this.closed=true;}}
  const env=environment({EventSource:FakeSource,navigator:{clipboard:{writeText:async text=>copied.push(text)}}});
  env.app.fetchAPI=async(url,options)=>{
    calls.push({url,options});
    if(options?.method==='POST')return {};
    const source=url.includes('console')?'console':'application';
    return {source,session_id:'run-1',entries:[{id:1,source,session_id:'run-1',level:'INFO',message:source==='console'?'INFO: GET /api/health 200 OK':'application record'}]};
  };
  env.load('features/logs/useLiveLogs.js');
  const h=mount(env.app.useLiveLogs,{confirmAction:async()=>true});
  await act(tick);
  assert.equal(sources.length,2);
  const application=sources.find(s=>s.url.includes('source=application'));
  const consoleSource=sources.find(s=>s.url.includes('source=console'));
  assert.match(application.url,/after=1/);assert.match(consoleSource.url,/after=1/);
  act(()=>{
    application.events.log({data:JSON.stringify({id:2,source:'application',session_id:'run-1',level:'ERROR',message:'app error'})});
    consoleSource.events.log({data:JSON.stringify({id:2,source:'console',session_id:'run-1',level:'INFO',message:'INFO: GET / 304 Not Modified'})});
    consoleSource.events.log({data:JSON.stringify({id:2,source:'console',session_id:'run-1',level:'INFO',message:'duplicate'})});
  });
  assert.equal(h.value.logSourceCounts.application,2);assert.equal(h.value.logSourceCounts.console,2);
  assert.equal(h.value.unreadLogErrors,1);
  act(()=>h.value.setLogSource('console'));
  await act(async()=>h.value.handleCopyLogs());
  assert.equal(copied[0],'INFO: GET /api/health 200 OK\nINFO: GET / 304 Not Modified');
  await act(async()=>h.value.handleClearLogs());
  assert.ok(calls.some(c=>c.url==='/logs/clear?source=console'&&c.options.method==='POST'));
  assert.equal(h.value.logSourceCounts.console,0);assert.equal(h.value.logSourceCounts.application,2);
  act(()=>consoleSource.events.log({data:JSON.stringify({id:3,source:'console',session_id:'run-1',level:'INFO',message:'new console line'})}));
  await act(async()=>h.value.handleClearLogFile());
  assert.equal(h.value.logSourceCounts.console,1);assert.equal(h.value.logSourceCounts.application,0);
  act(()=>{
    application.events.session({data:JSON.stringify({session_id:'run-2',source:'application'})});
    application.events.log({data:JSON.stringify({id:1,source:'application',session_id:'run-2',level:'INFO',message:'new application run'})});
    h.value.setLogSource('application');
  });
  assert.equal(h.value.logSessionId,'run-2');assert.equal(h.value.logEntries[0].message,'new application run');
  assert.equal(h.value.logSourceCounts.console,1);
  h.unmount();assert.ok(sources.every(s=>s.closed));assert.equal(env.listeners.size,0);
});

test('switching log tabs during confirmation clears the originally selected tab', async () => {
  const confirmation=deferred(),posts=[];
  const env=environment();
  env.app.fetchAPI=async(url,options)=>{
    if(options?.method==='POST'){posts.push(url);return {};}
    const source=url.includes('console')?'console':'application';
    return {source,session_id:'test',entries:[{id:1,source,level:'INFO',message:source}]};
  };
  env.context.EventSource=class {addEventListener(){}close(){}};
  env.load('features/logs/useLiveLogs.js');
  const h=mount(env.app.useLiveLogs,{confirmAction:()=>confirmation.promise});await act(tick);
  act(()=>h.value.setLogSource('console'));
  const clearing=h.value.handleClearLogs();
  act(()=>h.value.setLogSource('application'));
  await act(async()=>{confirmation.resolve(true);await clearing;});
  assert.deepEqual(posts,['/logs/clear?source=console']);
  assert.equal(h.value.logEntries[0].message,'application');h.unmount();
});

test('log source tabs support keyboard navigation and both locales', () => {
  const env=environment(),selected=[];
  vm.runInContext(read('i18n.js'),env.context);
  for(const [locale,appLabel,consoleLabel] of [['zh-CN','运行日志','控制台'],['en-US','Application logs','Console']]){
    env.context.GameTierI18n.setLocale(locale);
    env.load('features/logs/LogSidebar.jsx');
    let renderer;
    act(()=>{renderer=Renderer.create(React.createElement(env.app.LogSidebar,{
      width:400,source:'console',sourceCounts:{application:2,console:3},entries:[],connection:'connected',
      onSourceChange:name=>selected.push(name),
    }));});
    const tabs=renderer.root.findAllByType('button').filter(b=>b.props.role==='tab');
    assert.equal(tabs[0].findAllByType('span')[0].children[0],appLabel);
    assert.equal(tabs[1].findAllByType('span')[0].children[0],consoleLabel);
    assert.equal(tabs[1].props['aria-selected'],true);
    let focused=false;
    act(()=>tabs[1].props.onKeyDown({key:'ArrowLeft',preventDefault(){},currentTarget:{parentElement:{querySelector:()=>({focus(){focused=true;}})}}}));
    assert.equal(selected.at(-1),'application');assert.equal(focused,true);
    act(()=>renderer.unmount());
  }
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
