import { test, expect } from '@playwright/test';
import { BASE_URL, TEACHER_EMAIL, TEACHER_PASSWORD } from '../config';

test('教师端首页创建班级', async ({ page }) => {
  // 登录
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', TEACHER_EMAIL);
  await page.fill('input[name="password"]', TEACHER_PASSWORD);
  await page.click('button[type="submit"]');
  // 登录后等待跳转 dashboard
  await expect(page).toHaveURL(/teacher\/dashboard/);
  await page.screenshot({ path: 'tests/results/debug-dashboard.png' });

  // dashboard 页面点击 Create class 按钮（右上角或 Quick actions 区域）
  try {
    await page.click('button:has-text("Create class")', { timeout: 5000 });
  } catch {
    await page.click('text=Create class');
  }
  await expect(page).toHaveURL(/\/classes\/new/);

  // 填写班级信息前截图
  await page.screenshot({ path: 'tests/results/debug-create-class.png' });
  const className = 'E2E测试班级' + Date.now();
  // 精确定位班级名称输入框
  await page.fill('input[name="title"]', className);
  await page.click('button:has-text("Create")');

  // 等待跳转到新班级详情页
  await expect(page).toHaveURL(/\/classes\//);

  // 先等待.editorial-title元素出现，再断言其文本内容包含班级名，提升超时时间
  // 只断言包含班级名的.editorial-title元素可见，避免多元素冲突
  // 断言第一个匹配的.editorial-title且包含班级名的元素可见
  const classTitleLocator = page.locator('.editorial-title', { hasText: className }).first();
  await classTitleLocator.waitFor({ state: 'visible', timeout: 15000 });
  await expect(classTitleLocator).toBeVisible({ timeout: 15000 });
});
