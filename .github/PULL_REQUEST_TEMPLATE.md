## 这个 PR 做了什么

<!-- 一两句话说明改动 -->

## 为什么

<!-- 关联 Issue：Closes #123 -->

## 如何验证

- [ ] `npm test` 全绿
- [ ] 涉及界面 / OCR 的手工验证方式：

## 检查清单

- [ ] 未提交 `node_modules`、日志、本地数据或任何 API Key
- [ ] 分层未被打破（main / preload / renderer 职责清晰；主进程模块不依赖 electron）
- [ ] 新增逻辑尽量补了离线自测断言
