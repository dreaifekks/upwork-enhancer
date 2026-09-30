# Upwork Enhancer — App Store Connect 逐项填写稿

核对日期：2026-09-30。对应 macOS `0.1.21 (1)`。

当前网页已显示版本 `0.1.21`、已关联 Build `1`、已放入三张截屏；构建仍显示「缺少出口合规证明」。以下是填写建议和可复制文案，不代表已替你保存、确认声明或提交审核。

## 1. App 加密文稿

你贴出的四个选项，选择 **「不属于上述的任意一种算法」**，然后保存。

这是加密出口合规问卷。当前归档里的网络请求使用 Safari/Apple 系统提供的 HTTPS；没有自带加密算法、OpenSSL 等第三方加密实现。已核对归档内 14 个 manifest/src 文件与现有源码一致，两个原生可执行文件仅链接系统库。Apple 对仅使用操作系统内置加密的情况，不要求在 App Store Connect 上传加密文稿。

HTTPS 仍然使用加密；这里判断的是是否存在需要单独申报文稿的加密实现。如果后续出现一般性「是否使用加密」问题，应如实说明使用系统 HTTPS，不能把它解释成完全没有加密。

以后可以在 App 的 Info.plist 中声明：

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

含义是「不使用非豁免加密」。当前归档没有这个键，所以 Apple 展示了问卷。本次可直接回答网页问卷，不必仅为这个键重新上传。不要自行编造 `ITSEncryptionExportComplianceCode`。将来若加入自带加密库，需重新判断。

依据：[Apple 加密文稿要求](https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption/)、[Info.plist 声明说明](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)。

## 2. 当前「macOS App 版本 0.1.21」页面

当前语言是 **英语（美国）**。下列英文文案可直接复制；首发先填这一种商品页语言即可，扩展本身仍支持英文和中文。

| 字段 | 填什么 | 说明 |
| --- | --- | --- |
| App 预览 | 可以先留空 | 指演示视频，不是必填截屏 |
| 截屏 | 列表评分、展开的评估面板、设置页 | 现有三张已上传，但来源是 Chrome；建议用相同场景的 Safari 实拍替换，再完成送审核对 |
| 推广文本 | 复制下方推广文本 | 可选；已控制在 170 字符内 |
| 描述 | 复制下方描述 | 必填；纯文本，少于 4000 字符 |
| 关键词 | `freelance,jobs,workflow,productivity,client,scoring,screening` | 必填；英文逗号分隔，少于 100 字节 |
| 技术支持网址 | `https://dreaife.tokyo/en/projects/` | 用户已选择博客项目页。需先在左侧 profile 添加邮箱联系按钮并验证上线；公开邮箱地址尚待确认，当前页面还没有邮箱入口 |
| 营销网址 | `https://github.com/dreaifekks/upwork-enhancer` | 可选，也可以留空；仓库首页介绍产品 |
| 版本 | `0.1.21` | 当前已正确 |
| 版权 | `2026 QINGSHENG HE` | 以你为权利人的前提下填写；Apple 自动添加 ©，不用再写符号 |
| 构建版本 | `0.1.21 (1)` | 当前已关联 |
| Game Center | 不勾选 | 当前应用没有游戏服务 |
| 本版本新功能 | 首发不用填 | Apple 首个版本不提供该字段；以后更新再填 |
| App 沙盒信息 | 先留空 | 当前页面标注可选；若审核要求解释权限，再依据实际 entitlement 提供用途 |
| 版本发布方式 | 建议「手动发布此版本」 | 当前网页选中的是自动发布；手动发布允许通过审核后由你选择上线时机 |

### 推广文本

```text
Compare Upwork jobs in Safari with local scores, client signals, and risk notes. Optional AI works with your own API key.
```

### 描述

```text
Review Upwork opportunities while you browse in Safari.

Upwork Enhancer adds concise scoring badges to job listings and an opportunity review panel to job pages. Compare profile fit, client signals, competition, and potential risks before deciding where to spend your time.

FEATURES
- See an overall recommendation with a score breakdown and clear reasons.
- Customize preferred skills, project types, budget thresholds, and risk phrases.
- Save decisions, private notes, and tags locally in Safari.
- Import information from a visible freelancer profile into your preferences.
- Use English or Chinese extension text and light or dark appearance.
- Optionally connect your own compatible AI API for job analysis and screening-answer drafts that you review before using.

GET STARTED
Open Upwork Enhancer after installation, enable the extension in Safari Settings, and allow access to Upwork. Open a job list or job detail page to see the extension. Some Upwork pages require an Upwork account.

PURCHASE AND OPTIONAL AI
The purchase includes the Safari extension. Core local scoring works without an AI API key. Optional AI requires your own provider account, endpoint, model, and key. Any API usage fees are charged separately by that provider.

PRIVACY
Preferences and saved decisions are stored locally in this browser. When you start an AI action, relevant job content, your profile summary and preferences, and matching answer templates may be sent to the API endpoint you configure. The extension does not send this content to a developer-operated server. Your chosen provider's privacy and retention practices apply.

Made for Safari on Mac. Chrome and Safari extension data do not automatically sync. The extension does not automatically submit proposals or apply to jobs.

Upwork Enhancer is an independent, unofficial tool and is not affiliated with or endorsed by Upwork.
```

字段及长度依据：[Apple 版本信息字段](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)。

## 3. App 审核信息

| 字段 | 填什么 |
| --- | --- |
| 名字 | `QINGSHENG`，以你的真实审核联系人为准 |
| 姓氏 | `HE`，以你的真实审核联系人为准 |
| 电话号码 | 你能接听的真实号码，使用带 `+` 国家码的国际格式；在 Apple 后台填写 |
| 电子邮件 | 你会查看的审核联系邮箱；在 Apple 后台填写 |
| 需要登录 | 当前勾选。扩展没有自己的账号，但主要测试流程需要访问 Upwork 登录后的页面，因此不能仅以「扩展没有登录页」为由取消。只有确认完整测试路径确实无需登录时，才取消 |
| 用户名 / 密码 | 若审核流程需要登录，提供有权供审核使用的有效测试账号；不要编造或填写占位值 |
| 备注 | 复制下方说明，再补实际可用的测试访问方式和 AI 测试配置说明 |
| 附件 | 可选。可以补一段真实 Safari 启用及使用录屏；录屏用于辅助说明，不自动替代可运行的审核路径 |

审核联系资料不是商品页上的公开支持资料。密码、API Key 和审核账号不要写入仓库或公开支持页。

### 审核备注基础文案

```text
Upwork Enhancer is a macOS app containing a Safari Web Extension. The containing app provides the entry point to Safari's extension settings. The main functionality appears on Upwork webpages.

To test:
1. Open Upwork Enhancer and use its button to open Safari extension settings.
2. Enable Upwork Enhancer for the Safari profile used for testing and allow access to upwork.com.
3. Open an Upwork job list and then a job detail page. The extension adds scoring badges to list cards and an Opportunity Review panel to the detail page. Expand the panel to see the score breakdown, reasons, and decision fields.
4. Use the toolbar popup and Full settings to review preferences. Save a local decision and reload the page to verify persistence.

Core local scoring works with AI disabled. Optional AI uses a customer-provided compatible endpoint and API key; API usage is not included in the app purchase. AI actions can send relevant job content, profile summary/preferences, and matching answer templates to the configured provider. The extension does not automatically submit proposals, apply to jobs, or collect Upwork passwords.

The extension does not have its own account system. Upwork website authentication is separate and may be required to view job pages. The app is an independent, unofficial tool and is not affiliated with or endorsed by Upwork.
```

**送审前还需要补的真实信息：**审核人员能打开的 Upwork 测试路径、所需的有效登录方式，以及可选 AI 功能如何测试。当前代码没有独立的离线演示模式；不能在备注中声称已提供。暂时没有审核账号时，先解决可访问测试路径或与 App Review 确认演示安排，不把空账号当作已完成。

依据：[Apple 审核准备](https://developer.apple.com/app-store/review/)。

## 4. 左侧「App 信息」

| 字段 | 建议填写 |
| --- | --- |
| 名称 | `Upwork Enhancer` |
| 副标题 | `Review jobs with local scoring` |
| 主要语言 | 英语（美国） |
| 主要类别 | 效率 / Productivity |
| 次要类别 | 可留空；如要选，选工具 / Utilities |
| Bundle ID / SKU | 保持已创建记录的值，不新建另一个商品 |
| 许可协议 | 首发使用 Apple 标准 EULA；仓库源码的 Apache-2.0 许可仍保留 |
| 为儿童设计 | 否 |
| 内容版权 | 应用访问并展示来自 Upwork 的第三方职位内容。涉及「有权使用」的声明，要依据实际许可或适用权利确认；不能因为代码原创或注明非官方，就直接选择「不涉及第三方内容」 |

名称、图标和文案需清楚体现独立工具身份，不声称得到 Upwork 官方认可。这里没有替你确认第三方内容授权。

### 年龄分级问卷

按扩展自身提供的功能回答，不能直接为了得到 4+ 而全部选「无」；具体等级由问卷计算。

| 问题 | 当前实现对应的建议 |
| --- | --- |
| 家长控制、年龄验证 | 无；当前没有这些功能 |
| 不受限网页访问 | 按当前容器/扩展功能选否：不包含可任意导航的内置浏览器；Safari 宿主浏览器本身能上网不等于本 App 提供浏览器功能 |
| 用户之间的消息与聊天 | 否；AI 分析不属于用户之间聊天，扩展也不提供 Upwork 消息功能 |
| 广告 | 扩展自身未投放广告 |
| 赌博、模拟赌博、抽奖、付费随机奖励 | 当前扩展没有这些功能；职位文字提到某行业不等于扩展提供该活动 |
| 公开用户生成内容 | 私人笔记/模板没有公开分享功能；同时核心界面会显示第三方用户撰写的职位内容。此项需结合问卷完整定义确认其对宿主网页内容的范围，不把「无自建社区」等同于已经排除所有 UGC |
| 暴力、色情、药物、医疗等内容频率 | 扩展没有内置这类内容；仍需按实际会展示的职位文字和 AI 输出评估，不能替任意网页/任意模型保证永不出现 |

定义依据：[Apple 年龄分级字段](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/)。

## 5. 左侧「App 隐私」

隐私政策 URL 可以填这个已经可公开访问的页面：

```text
https://github.com/dreaifekks/upwork-enhancer/blob/master/docs/PRIVACY_POLICY.md
```

隐私选择 URL 为可选，没有专门网页可暂时留空。

### 已确认的数据流

| 数据/功能 | 当前行为 |
| --- | --- |
| 本地评分、偏好、保存的决定、便签、标签 | 使用 Safari 扩展本地存储；不因此自动上传 |
| 导入的完整 profile snapshot | 本地保存；AI 请求不会整体原样上传 snapshot |
| AI 分析/回答草稿 | 发送职位标题、描述、技能、预算/客户信号，及个人简介摘要、偏好、相关回答模板 |
| 自动生成的个人简介摘要 | 包含标题、时薪、介绍、技能、作品文字和语言；默认不单独拼接姓名、位置或 profile URL |
| API Key | 本地保存；请求时通过 Authorization 发送给用户配置的 API 服务 |
| 分析、广告、设备追踪 SDK / 开发者数据服务器 | 当前代码没有 |

### 如何判断是否属于 App Privacy 的「收集」

先判断是否发生需要申报的收集，再选择数据类别。不能从「存在 API Key」「请求发给第三方」直接推导出必须申报用户 ID，也不能先把所有请求内容都假定为开发者收集。

Apple 的定义同时涉及：数据离开设备，以及开发者或其第三方合作伙伴能在实时处理请求所需时间之外继续访问这些数据。只在设备上存储不属于这种收集。Apple 还明确举例：仅用于服务请求、处理后不留存的鉴权 token 无需因此披露。

| 情况 | 判断 |
| --- | --- |
| Key、偏好和决定保存在用户 Safari 本地 | 不因本地存储而构成开发者远端收集 |
| 用户的 API 服务已有其账号及 Key 记录 | 这些记录的存在，不能单独证明扩展新收集了用户 ID |
| 开发者提供的后台、代理、SDK 或合作处理服务留存请求 | 即使开发者自己不保存，也需要把相应合作方的收集纳入判断 |
| 用户自行配置独立服务，扩展作为通用客户端直接连接 | 不应未经判断就把任意用户自选服务归为开发者的第三方合作伙伴；Apple 公开说明未对所有 BYOK 客户端给出一律适用的单独规则 |

当前核对到的实现：AI 默认关闭，base URL 与 API Key 均由用户填写，没有开发者服务器/代理或分析广告 SDK；请求由用户设备直接发送到配置的端点。因此可以确认**开发者端没有接收或远端留存这些请求**。

在「用户独立选择并直接使用自己的 API 服务，开发者不提供或委托远端处理服务」这个前提下，将本 App 作为通用客户端按 **不收集数据** 填写，是当前架构对应定义的一种合理解释。这是解释判断，不是 Apple 明文公布的 BYOK 豁免或已取得的审核结论。仅凭使用用户自己的 Key，并不能为任何固定集成的 AI 服务免除披露；如果服务实际作为开发者提供的处理方，需核对其留存和用途。

**撤回之前固定勾选三项/四项及相应身份关联答案的建议。** 那些建议跳过了「服务是否属于开发者合作方、是否发生留存」的前提，不能继续当成已确认的申报答案。如果最终确认某个合作服务确有收集，再依据实际数据映射到其他用户内容、浏览历史、个人时薪等类别，填写对应用途。

隐私政策仍应明确说明实际网络行为：用户启用 AI 并发起操作时，扩展直接向用户指定的 API 发送所需职位内容、个人简介/偏好和相关回答模板；开发者不会收到、代理或远端保存这些请求；用户选定的服务遵循其自身的数据政策。不要将「开发者不收集」写成「数据从不离开设备」。

若需要向 App Review 核实，可说明：

```text
The extension is a client for an optional user-configured AI endpoint. Users supply their own service URL and API key. Requests are sent directly from the user's device to that endpoint, without a developer-operated server, proxy, analytics SDK, or remote logging. Settings and keys are stored locally. The API provider is independently selected by the user. Does App Store Connect require this independently selected provider's data practices to be included as those of a third-party partner in this generic-client configuration?
```

依据：[Apple App Privacy 的收集、合作伙伴、设备内处理与鉴权 token 定义](https://developer.apple.com/app-store/app-privacy-details/)。

## 6. 价格、商务与其他页面

| 页面/字段 | 填写方式 |
| --- | --- |
| 价格与销售范围 → 基准国家 | 日本 |
| 价格 | JPY 100，一次性付费下载 |
| 其他已选择的销售地区 | 可以先使用 Apple 自动换算价格，再核对；基准国家不等于只在该国销售 |
| 销售范围 | 选择你实际准备开放的地区；若出现当地额外必填资料，按真实情况完成 |
| 商务 → 付费 App 协议 | 由账号持有人阅读并确认；按后台要求补银行/税务资料 |
| App 内购买项目、订阅 | 当前方案不用创建 |
| Game Center、提名、促销代码 | 首发不用配置 |
| App 辅助功能 | 只声明实际测试支持的功能；未完成 VoiceOver 等验证时，不预先勾选支持 |
| 贸易商/DSA 等地区身份字段（如出现） | 根据本人实际经营身份填写；不根据「个人开发者」或售价低就自动判断 |

定价依据：[Apple 设置价格](https://developer.apple.com/help/app-store-connect/manage-app-pricing/set-a-price/)。

## 7. 当前待补项

- 在已选的博客项目页左侧 profile 添加公开邮箱按钮并验证上线；审核联系资料直接在 Apple 后台填写。
- 第三方 AI 留存与用途对应的隐私申报、第三方内容权利声明、完整年龄分级答案。
- 审核人员实际可用的 Upwork 与 AI 测试路径。
- Safari 实拍及运行验证；当前上传三张素材原本是 Chrome 截图。
- 当前上传容器还是默认启用页，没有发现应用内隐私政策链接。可以先填写商品页，但送审前应补好可访问的应用内隐私入口并验证；如果修改安装包，需要提高 Build 编号、重新上传并替换所选构建。

这份稿件没有修改已上传的二进制，也没有替你提交加密/隐私声明或送审。
