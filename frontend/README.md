# 前端开发约定

前端仍使用项目自带的 React 18、ReactDOM、Babel 和 html2canvas。源码直接由 FastAPI 提供，运行和 PyInstaller 打包均不需要 Node 构建步骤。Node 仅用于可选的开发回归测试。

## 入口与模块

- `index.html`：会话引导标记、样式入口、按依赖排列的脚本清单。
- `src/main.jsx`：唯一 React 挂载入口。
- `src/App.jsx`：组合各功能 hook、协调初始化与页面布局。
- `src/core/`：API、会话、偏好纯函数、导出、拖拽、提示和显示工具。
- `src/hooks/`：通用交互状态，包括弹窗队列、偏好、语言和并发加载。
- `src/features/`：模板、排序区、图片库、搜索、设置、平台账号、日志和图片操作。
- `styles/app.css`：按原先级联顺序导入分区样式；末尾 `overrides.css` 保留原文件后半段的覆盖规则。

每个脚本使用 IIFE 隔离作用域，只通过 `window.GameTierApp` 导出显式接口。新增模块必须加入 `index.html`，排在其依赖之后、使用者之前。应用脚本统一由 Babel 按清单顺序执行，不要给它们增加 `async`，也不要在当前加载方式中直接加入 `import/export`。

功能状态保存在各自 React hook 中。根组件传递按功能划分的 model，展示组件只解构需要的数据与动作；不要增加一个装下全部状态的全局 store。需要后声明模块的动作时，根组件传入延迟调用的函数，禁止在 hook 渲染阶段执行这些动作。

模板列表和快照由 `useTemplates` 统一维护。平台回调和回填通过 `getCurrentTemplate()` 读取最新模板，不能持有自己的快照副本。跨文件的拖拽图片 ID 使用 `dragState` 对象保持实时共享，不能解构为初始值副本。

## 必须保留的启动契约

`index.html` 中的 `__GTM_SESSION_BOOTSTRAP__` 由 `main.py` 替换。`core/session.js` 只交换一次会话并移除 DOM 标记，所有 API 请求和 SSE 连接等待同一个 `localSessionReady`。不把会话凭据加入静态资源、URL 或本地存储。

页面必须经 `main.py` 打开，不能直接用文件浏览器打开 HTML。桌面偏好通过后端配置恢复；`localStorage` 仅承担现有浏览器保存和回退职责，不能替代跨随机端口的桌面恢复。

## 开发验证

在项目根目录执行：

```powershell
npm ci --prefix tools/frontend
npm test --prefix tools/frontend
```

测试依赖只安装在 `tools/frontend/node_modules`，不会进入 EXE。测试使用 React 18.3.1 的真实 hooks 和受控网络边界，不读取用户配置，也不调用第三方平台。覆盖模块加载顺序、模板请求乱序、搜索取消与防重、弹窗结算、设置保存、偏好恢复、日志连接、Steam 回调和回填队列。

随后按修改范围进行浏览器、真实 WebView 和打包检查。测试通过不等于真实第三方账号绑定成功。完整方案和执行记录见根目录 `FRONTEND_REFACTOR_PLAN.md`。

## 打包

沿用根目录 `GameTierMaker.spec`，它会收集整个 `frontend` 目录，包含新增脚本和 CSS。修改前端后必须重新打包，已生成的 EXE 不会实时读取源码目录。

如需单独生成验收包而不覆盖常规输出：

```powershell
.\.venv\Scripts\python.exe -m PyInstaller --noconfirm --distpath dist/frontend-refactor GameTierMaker.spec
```

该 EXE 使用其自身目录下的 `GameTierMaker_Data`；不要将其他目录的用户数据混入验收测试。
