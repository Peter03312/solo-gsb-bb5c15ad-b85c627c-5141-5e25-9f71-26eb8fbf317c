# 字幕组协作校对平台

供字幕组多人协作校对 SRT 字幕的 Web 应用。支持上传 SRT、按原顺序查看与编辑片段（文字 + 起止时间）、
每次提交留修订记录、审核者逐段确认、整体发布不可变版本并下载对应 SRT。

技术栈：**React 18（Vite）+ Node.js（Express）+ PostgreSQL**。
前端构建产物由 Express 一并托管，因此生产环境只需一个应用容器 + 一个数据库容器。

---

## 一键启动（Docker Compose）

前置要求：已安装 Docker 与 Docker Compose 插件（`docker compose version` 可用）。

```bash
# 在项目根目录（docker-compose.yml 所在目录）
docker compose up -d --build
```

首次启动会：

1. 启动 PostgreSQL 16，并自动执行 [`db/init/01_schema.sql`](db/init/01_schema.sql)
   完成建表、索引与演示用户初始化；
2. 构建并启动应用（多阶段构建：先打包 React，再安装生产依赖）。

查看日志 / 停止：

```bash
docker compose logs -f app     # 跟踪应用日志
docker compose down            # 停止并移除容器（数据仍保留在命名卷中）
docker compose down -v         # 同时删除数据库数据卷（彻底重置）
```

## 访问地址与端口

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| **Web 应用 / API** | **http://localhost:8080** | 浏览器访问此地址即可 |
| PostgreSQL | `localhost:5432` | 仅映射到本机便于调试，可在 compose 中删除该映射 |

容器内应用监听 `4000`，宿主机默认映射到 **8080**。

> 首次访问若数据库还在初始化，应用会自动等待并重连数据库，就绪后即可使用。

## 配置

所有配置通过环境变量覆盖，均有默认值，开箱即用。可复制 `.env.example` 为 `.env` 后修改：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `APP_PORT` | `8080` | 宿主机访问 Web 的端口 |
| `POSTGRES_USER` | `subtitle` | 数据库用户 |
| `POSTGRES_PASSWORD` | `subtitle` | 数据库密码 |
| `POSTGRES_DB` | `subtitle` | 数据库名 |
| `POSTGRES_PORT` | `5432` | 宿主机数据库调试端口 |

应用容器内另支持：`DATABASE_URL`（数据库连接串，compose 已自动拼接）、`PORT`（容器内监听端口，默认 4000）。

示例：改用 9000 端口启动

```bash
APP_PORT=9000 docker compose up -d --build
# 然后访问 http://localhost:9000
```

## 演示账号

初始化时创建 4 个用户，可在页面右上角下拉切换身份（演示环境用 `x-user-id` 请求头标识身份）：

| 用户名 | 角色 | 权限 |
| --- | --- | --- |
| `alice` | editor（编辑） | 上传、编辑片段、提交修订 |
| `bob` | editor（编辑） | 同上 |
| `carol` | reviewer（审核者） | 编辑权限 + 确认/撤销片段 + 发布 |
| `admin` | admin（管理员） | 同审核者 |

## 使用流程

1. 以 `alice` 身份在首页填写标题并上传 SRT（可直接使用 [`examples/sample.srt`](examples/sample.srt)）。
   - 导入前会完整校验文件；**任一片段非法都会指出行号且不导入任何内容**。
2. 在项目详情页按原顺序查看片段，点击「编辑」修改文字与起止时间后「提交修订」。
   - 每次提交都会在「修订记录」中追加一条不可篡改的历史（作者、时间、内容、基于哪个修订）。
   - 时间必须非负、起点早于终点；若调整边界会与相邻片段重叠，系统会**指出冲突片段与重叠区间且拒绝保存，绝不自动挪动相邻内容**。
3. 多人同时编辑时：
   - 若你基于的修订已被他人更新，提交会收到 **409**，并返回**当前内容与候选时间的冲突信息**，核对后基于最新版本重新提交即可；
   - 对**不同片段**的修改互不阻塞，可正常继续提交。
4. 以 `carol` 身份对片段点「确认片段」。**已确认片段若再被编辑，会自动退回「待审核」，需重新确认。**
5. 全部片段确认后点「发布新版本」。
   - 发布在**单个数据库事务**中**原子校验整条时间轴**：只要存在未确认片段或任意重叠/非法时间，就拒绝并逐条指出位置；
   - 发布期间对片段的编辑会被项目级锁阻塞，**不会混入正在发布的版本**；
   - 发布成功后生成**不可变快照**，可在版本列表「查看」或「下载 SRT」。发布之后的任何编辑都不影响历史版本。

## 本地开发（不用 Docker）

需要本机或可达的 PostgreSQL 14+，并先执行 `db/init/01_schema.sql`。

```bash
# 终端 1：后端
cd server
npm install
DATABASE_URL='postgres://subtitle:subtitle@localhost:5432/subtitle' npm run dev

# 终端 2：前端（Vite dev server，自动代理 /api 到 :4000）
cd web
npm install
npm run dev          # http://localhost:5173
```

前端开发代理目标可用环境变量 `VITE_API_PROXY` 覆盖（默认 `http://localhost:4000`）。

## 目录结构

```
.
├── db/init/01_schema.sql   # 数据库初始化：表、约束、索引、种子用户
├── server/                 # Express API
│   └── src/
│       ├── index.js        # 入口：静态托管 + API + 健康检查
│       ├── app.js          # 路由与全部业务规则（事务/锁/并发）
│       ├── db.js           # 连接池、事务与项目级咨询锁封装
│       ├── srt.js          # SRT 解析/序列化（错误带行号）
│       └── timeline.js     # 片段级与整条时间轴校验
├── web/                    # React + Vite 前端
│   └── src/components/     # 项目、片段编辑、修订历史、发布版本等组件
├── Dockerfile              # 多阶段构建（web 构建 → server 依赖 → 运行镜像）
├── docker-compose.yml      # app + db 一键启动（含数据库初始化）
└── examples/sample.srt     # 可用于测试的示例字幕
```

## 数据模型与一致性要点

- `segments`：每段的**当前**状态（文字、起止、确认状态、当前修订指针），`position` 记录原顺序且永不重排。
- `revisions`：**只增不改**的修订链，记录作者、时间、内容及 `based_on_revision_id`（乐观并发依据）。
- `releases` / `release_segments`：发布时逐段复制的**不可变快照**，与后续编辑物理隔离。
- 所有写操作在事务中执行，并对同一项目获取 PostgreSQL 咨询锁（`pg_advisory_xact_lock`）串行化：
  - 保证同段并发提交的检测可靠、不同段互不阻塞；
  - 保证发布快照与发布期间的编辑严格隔离。
- 数据库层设有 `CHECK`（非负、起点 < 终点）与外键约束作为最后防线。

## API 摘要

所有 `/api/*`（除 `/api/health`）需带请求头 `x-user-id: <用户id>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/users` | 用户列表 |
| GET | `/api/projects` | 项目列表 |
| POST | `/api/projects?title=<标题>` | 上传 SRT（`text/plain` 请求体），失败 422 带 `line` |
| GET | `/api/projects/:id` | 项目详情（片段 + 发布版本） |
| GET | `/api/projects/:id/segments/:pos/revisions` | 片段修订历史 |
| POST | `/api/projects/:id/segments/:pos/revisions` | 提交修订（400 字段 / 409 旧修订 / 422 重叠） |
| POST | `/api/projects/:id/segments/:pos/confirm` | 确认片段（需审核者） |
| POST | `/api/projects/:id/segments/:pos/unconfirm` | 撤销确认（需审核者） |
| POST | `/api/projects/:id/publish` | 原子校验并发布（需审核者） |
| GET | `/api/releases/:id` | 查看不可变版本 |
| GET | `/api/releases/:id/download` | 下载该版本的 SRT |
