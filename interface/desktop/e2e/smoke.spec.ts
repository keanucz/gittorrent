import { test, expect } from '@playwright/test'

test.describe('Desktop Smoke Test', () => {
  test('app launches and shows home screen', async ({ page }) => {
    await page.goto('http://localhost:1420')
    await expect(page).toHaveTitle(/gittorrent/i)
    await expect(page.locator('h1')).toContainText(/gittorrent/i)
  })

  test('can navigate to settings', async ({ page }) => {
    await page.goto('http://localhost:1420')
    await page.click('text=Settings')
    await expect(page.locator('h2')).toContainText(/Settings/i)
  })

  test('can navigate to seed', async ({ page }) => {
    await page.goto('http://localhost:1420')
    await page.click('text=Seed')
    await expect(page.locator('h2')).toContainText(/Seed/i)
  })
})
