import { test, expect } from '@playwright/test'

test.describe('Prequel Portal E2E Tests', () => {
  test('loads homepage and displays title', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle(/Prequel Portal/)
    await expect(page.getByText('Prequel Portal')).toBeVisible()
    await expect(
      page.getByText('Manage coding interviews and VS Code instances')
    ).toBeVisible()
  })

  test('displays main navigation buttons', async ({ page }) => {
    await page.goto('/')

    await expect(
      page.getByRole('button', { name: 'Create New Interview' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
  })

  test('opens create interview modal', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Create New Interview' }).click()

    await expect(page.getByText('Create New Interview')).toBeVisible()
    await expect(page.getByLabel('Candidate Name')).toBeVisible()
    await expect(page.getByLabel('Interview Challenge')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  test('validates form input in create interview modal', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Create New Interview' }).click()

    // Submit button should be disabled when candidate name is empty
    await expect(
      page.getByRole('button', { name: 'Create Interview' })
    ).toBeDisabled()

    // Enter candidate name
    await page.getByLabel('Candidate Name').fill('Test Candidate')

    // Now submit button should be enabled
    await expect(
      page.getByRole('button', { name: 'Create Interview' })
    ).toBeEnabled()
  })

  test('can select different challenges', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Create New Interview' }).click()

    const challengeSelect = page.getByLabel('Interview Challenge')
    await expect(challengeSelect).toBeVisible()

    // Check default selection
    await expect(challengeSelect).toHaveValue('javascript')

    // Change to Python
    await challengeSelect.selectOption('python')
    await expect(challengeSelect).toHaveValue('python')

    // Change to SQL
    await challengeSelect.selectOption('sql')
    await expect(challengeSelect).toHaveValue('sql')
  })

  test('can close create interview modal', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Create New Interview' }).click()
    await expect(page.getByText('Create New Interview')).toBeVisible()

    // Close via Cancel button
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Create New Interview')).not.toBeVisible()

    // Open again and close via clicking outside (if that behavior is implemented)
    await page.getByRole('button', { name: 'Create New Interview' }).click()
    await expect(page.getByText('Create New Interview')).toBeVisible()
  })

  test('displays interviews table', async ({ page }) => {
    await page.goto('/')

    // Check table headers
    await expect(page.getByText('Candidate')).toBeVisible()
    await expect(page.getByText('Challenge')).toBeVisible()
    await expect(page.getByText('Status')).toBeVisible()
    await expect(page.getByText('Access Details')).toBeVisible()
    await expect(page.getByText('Actions')).toBeVisible()
  })

  test('shows loading state initially', async ({ page }) => {
    await page.goto('/')

    // Should see loading indicator briefly
    await expect(page.getByText('Loading interviews...')).toBeVisible({
      timeout: 100,
    })
  })

  test('shows empty state when no interviews exist', async ({ page }) => {
    // Mock the API to return empty results
    await page.route('/api/interviews*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ interviews: [] }),
      })
    })

    await page.goto('/')

    await expect(page.getByText('No interviews created yet')).toBeVisible()
  })

  test('displays mock interview data', async ({ page }) => {
    // Mock the API to return sample interview data
    await page.route('/api/interviews*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          interviews: [
            {
              id: 'int-1',
              candidateName: 'John Doe',
              challenge: 'javascript',
              status: 'active',
              accessUrl: 'https://example.com/int-1',
              password: 'test123',
              createdAt: '2024-01-01T10:00:00Z',
            },
            {
              id: 'int-2',
              candidateName: 'Jane Smith',
              challenge: 'python',
              status: 'initializing',
              createdAt: '2024-01-01T11:00:00Z',
            },
          ],
        }),
      })
    })

    await page.goto('/')

    // Check interview data is displayed
    await expect(page.getByText('John Doe')).toBeVisible()
    await expect(page.getByText('Jane Smith')).toBeVisible()
    await expect(page.getByText('JavaScript')).toBeVisible()
    await expect(page.getByText('Python')).toBeVisible()
    await expect(page.getByText('active')).toBeVisible()
    await expect(page.getByText('initializing')).toBeVisible()
  })

  test('can open logs modal for interview', async ({ page }) => {
    // Mock the interviews API
    await page.route('/api/interviews*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          interviews: [
            {
              id: 'int-1',
              candidateName: 'John Doe',
              challenge: 'javascript',
              status: 'active',
              createdAt: '2024-01-01T10:00:00Z',
            },
          ],
        }),
      })
    })

    // Mock the operations API
    await page.route('/api/operations*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ operations: [] }),
      })
    })

    await page.goto('/')

    // Click logs button
    await page.getByText('Logs').click()

    // Check logs modal opens
    await expect(
      page.getByText('Operation Logs - Interview int-1')
    ).toBeVisible()
    await expect(
      page.getByText('Select an operation to view logs')
    ).toBeVisible()
  })

  test('can refresh interviews', async ({ page }) => {
    let requestCount = 0

    // Mock the API and count requests
    await page.route('/api/interviews*', async route => {
      requestCount++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ interviews: [] }),
      })
    })

    await page.goto('/')

    // Wait for initial load
    await expect(page.getByText('No interviews created yet')).toBeVisible()
    expect(requestCount).toBe(1)

    // Click refresh
    await page.getByRole('button', { name: 'Refresh' }).click()

    // Should trigger another API call
    await page.waitForTimeout(100)
    expect(requestCount).toBe(2)
  })

  test('handles API errors gracefully', async ({ page }) => {
    // Mock API to return error
    await page.route('/api/interviews*', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server error' }),
      })
    })

    await page.goto('/')

    // Should still load the page without crashing
    await expect(page.getByText('Prequel Portal')).toBeVisible()
    // Empty state should be shown after error
    await expect(page.getByText('No interviews created yet')).toBeVisible()
  })

  test('form submission workflow (mocked)', async ({ page }) => {
    // Mock successful creation
    await page.route('/api/interviews/create', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          interview: {
            id: 'new-int',
            candidateName: 'Test User',
            challenge: 'javascript',
            status: 'initializing',
          },
        }),
      })
    })

    // Mock initial interviews list
    await page.route('/api/interviews', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ interviews: [] }),
      })
    })

    await page.goto('/')

    // Open create form
    await page.getByRole('button', { name: 'Create New Interview' }).click()

    // Fill form
    await page.getByLabel('Candidate Name').fill('Test User')
    await page.getByLabel('Interview Challenge').selectOption('javascript')

    // Submit form
    await page.getByRole('button', { name: 'Create Interview' }).click()

    // Should show notification
    await expect(
      page.getByText('Interview creation started for Test User')
    ).toBeVisible()

    // Modal should close
    await expect(page.getByText('Create New Interview')).not.toBeVisible()
  })
})
