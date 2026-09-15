# Tera Wallet（中文）

Tera Wallet 是面向现实世界资产（RWA）工作流的自托管钱包体验。助手可以解释资产并准备结构化提案，所有者查看检查结果后，在自己的钱包中批准精确交易。产品部署方向基于 Robinhood Chain（Arbitrum Orbit L2），默认以隐私为先：**代理负责思考，Tera 负责检查，你负责批准。**

**产品入口：** [钱包](https://terawallet.app/dashboard/) · [白皮书](https://terawallet.app/whitepaper) · [路线图](https://terawallet.app/roadmap/)

**社区：** [X](https://x.com/terawalletrh) · [Telegram](https://t.me/terawalletrh)

**合约地址：** `0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8`

## 核心能力

| 能力                 | 说明                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| **所有者监督的提案** | 助手把请求转换为结构化的转账或工作流提案，所有者在签名之前进行审核。         |
| **审核关卡**         | 在请求钱包签名前展示资产、资格、策略、风险和所有者批准状态。                 |
| **钱包连接**         | 使用 RainbowKit 支持已安装的钱包和 WalletConnect，并连接 Robinhood Chain。   |
| **资产注册表**       | 在仪表盘查看支持的资产、精度、合约地址、资格状态和可用操作。                 |
| **会话与回执**       | 查看代理会话、撤销状态、交易状态和区块浏览器链接。                           |
| **隐私方向**         | 助手只接收准备提案所需的消息和钱包地址；私有策略与选择性披露能力持续建设中。 |

当前仓库已经演示监督式提案流程及其后端集成。ERC-4337 智能账户执行、生产级 ERC-3643 适配器、零知识策略证明和加密选择性披露回执仍属于后续协议阶段。

## 工作流程

每个由用户或代理发起的操作都会经过固定的确定性关卡。自然语言不能扩大执行范围：

1. 资产注册表：资产和路线是否受支持？
2. 资格预检查：发行方和合规条件是否通过？
3. 私有策略：提案是否符合所有者的限制？
4. 风险检查：价格影响、滑点和边界是否安全？
5. 所有者批准：是否需要钱包签名？

## 后端 API

后端是运行在 Bun 上的 Express 服务，主要接口包括：

- `GET /health`：服务健康状态、时间和版本
- `GET /api/assets`：资产注册表和支持的操作
- `POST /api/assets/preflight`：资产与资格预检查
- `POST /api/agent/chat`：处理所有者消息的助手响应
- `POST /api/agent/propose`：准备所有者审核提案
- `POST /api/intent/prepare`：准备意图检查和交易数据
- `GET /api/intent/:actionHash`：查询意图状态
- `POST /api/intent/receipt`：核对已提交交易回执
- `POST /api/account/register`、`GET /api/account/:address`：账户初始化和状态
- `GET /api/account/:address/history`：账户历史
- `POST /api/session/prepare-register`、`POST /api/session/register`：准备并注册会话
- `GET /api/session/:accountAddress`：列出账户会话
- `POST /api/session/prepare-revoke`、`POST /api/session/revoke`：准备并撤销会话

## 路线图

- [x] **阶段 A — RWA 准备**：资产注册表、查看器、发行方限制展示和演示环境
- [x] **阶段 B — 监督式提案层**：助手对话、结构化提案、审核关卡、钱包批准和回执
- [x] **阶段 C — 集成基础**：意图、资产、账户和会话接口，以及前端预检查和回执处理
- [ ] **阶段 D — 生产级执行**：ERC-4337 UserOperation、不可重放哈希和链上所有者授权
- [ ] **阶段 E — 受限自动化**：低风险操作的受限会话密钥、生产注册和撤销执行
- [ ] **阶段 F — 私有策略证明**：本地/私有策略评估、零知识合规证明和选择性披露回执

## 本地运行

需要 Bun 1.1+、Node.js 20+ 和 PostgreSQL。

```bash
bun install
cp .env.example .env
bun run dev
```

运行前端测试：

```bash
bun run test:frontend
```

运行后端测试：

```bash
cd backend
bun install
bun run test
```

## 技术栈

- **前端**：TanStack Start、React 19、Vite、Tailwind CSS v4、Radix UI
- **后端**：TypeScript、Bun、Express、PostgreSQL（`pg`）
- **链与协议方向**：Robinhood Chain、ERC-4337、ERC-3643
- **部署**：Vercel（前端）、Render（后端）

English version: [README.md](README.md)
