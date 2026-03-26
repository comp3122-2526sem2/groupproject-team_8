# e2e 测试执行指南

## 1. 环境准备
- 确保已安装依赖：`pnpm install`
- Playwright 依赖已安装：`pnpm exec playwright install`
- 可选：设置环境变量覆盖默认账号/URL

## 2. 配置
- 测试配置文件：`tests/config.ts`
- 可通过环境变量覆盖：
  - `E2E_BASE_URL`：被测系统地址
  - `E2E_TEACHER_EMAIL`、`E2E_TEACHER_PASSWORD`：教师账号

## 3. 执行测试
- 单个用例：
  ```sh
  npx playwright test tests/e2e/teacher-classes.spec.ts
  ```
- 全部用例：
  ```sh
  npx playwright test tests/e2e/
  ```

## 4. 结果查看
- 测试截图、调试图片、结果输出统一保存在 `tests/results/` 目录
- 失败时可查看对应 PNG 文件辅助定位

## 5. 常见问题
- 若遇到账号风控、API限流等问题，可更换账号或稍后重试
- 如需自定义测试数据，请编辑 `tests/config.ts`
