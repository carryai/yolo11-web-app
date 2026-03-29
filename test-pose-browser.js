import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE_PATH = path.join(__dirname, 'test-4-person.jpg');

async function testPoseModel() {
  console.log('Starting pose model test with main application...\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-cache']
  });

  const page = await browser.newPage();

  // Disable cache
  await page.setCacheEnabled(false);

  // Capture console logs
  const logs = [];
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    logs.push({ type, text, time: Date.now() });
    console.log(`[${type.toUpperCase()}] ${text}`);
  });

  page.on('pageerror', error => {
    console.log(`[PAGE ERROR] ${error.message}`);
    logs.push({ type: 'error', text: error.message, time: Date.now() });
  });

  try {
    // Navigate to main app with debug=true
    console.log('\n--- Navigating to main app with debug=true ---\n');
    await page.goto('http://localhost:5173/?debug=true&t=' + Date.now(), {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for app to load
    await page.waitForSelector('button:has-text("Models")', { timeout: 10000 });
    console.log('App loaded\n');

    // Wait a moment for React to fully initialize
    await new Promise(r => setTimeout(r, 1000));

    // Click Models button to open modal
    console.log('--- Opening Model Library ---');
    await page.click('button:has-text("Models")');

    // Wait for modal to appear
    await page.waitForSelector('text=Model Library', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 500));

    // Find and click the Load button for yolo26n-pose model
    console.log('--- Loading pose model ---');

    // Get all buttons and find the Load button for yolo26n-pose
    const loadButtons = await page.$$('button');
    let loadedModel = false;

    for (const btn of loadButtons) {
      const btnText = await page.evaluate(el => el.textContent, btn);
      if (btnText === 'Load') {
        // Check if parent contains yolo26n-pose
        const parent = await btn.evaluateHandle(el => el.parentElement?.parentElement);
        if (parent) {
          const parentText = await page.evaluate(el => el.textContent, parent);
          if (parentText && parentText.includes('yolo26n-pose')) {
            await btn.click();
            loadedModel = true;
            break;
          }
        }
      }
    }

    if (!loadedModel) {
      console.log('Could not find Load button for yolo26n-pose, trying alternative method...');
      // Try clicking any Load button
      for (const btn of loadButtons) {
        const btnText = await page.evaluate(el => el.textContent, btn);
        if (btnText === 'Load') {
          await btn.click();
          loadedModel = true;
          break;
        }
      }
    }

    // Wait for model to load
    console.log('Waiting for model to load...\n');
    await new Promise(r => setTimeout(r, 5000));

    // Upload test image
    console.log('--- Uploading test image ---');
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) {
      throw new Error('File input not found');
    }
    await fileInput.uploadFile(TEST_IMAGE_PATH);

    // Wait for image to load and inference to run
    console.log('Waiting for image upload and inference...\n');
    await new Promise(r => setTimeout(r, 8000));

    // Get stats from page
    const stats = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return {
        canvasExists: !!canvas,
        canvasWidth: canvas?.width,
        canvasHeight: canvas?.height
      };
    });

    console.log('\n========== TEST RESULTS ==========');
    console.log('Canvas stats:', stats);
    console.log('=================================\n');

    // Analyze logs for errors
    const errors = logs.filter(l => l.type === 'error' || l.type === 'warning');
    const infoLogs = logs.filter(l => l.type === 'log' || l.type === 'info');

    // Find debug logs
    const debugLogs = logs.filter(l => l.text.includes('DEBUG'));
    console.log('\n--- Debug Output ---');
    debugLogs.forEach(l => console.log(l.text));

    console.log('\n--- Summary ---');
    console.log(`Total logs: ${logs.length}`);
    console.log(`Errors/Warnings: ${errors.length}`);
    console.log(`Info logs: ${infoLogs.length}`);

    // Check for specific issues
    const hasConfidenceError = logs.some(l =>
      l.text.includes('2000%') ||
      (l.text.includes('confidence') && l.text.includes('%') && parseFloat(l.text) > 100)
    );

    const hasBoundingBoxError = logs.some(l =>
      l.text.includes('bbox') && (l.text.includes('NaN') || l.text.includes('Infinity'))
    );

    const hasKeypointError = logs.some(l =>
      l.text.includes('keypoint') && l.text.includes('error')
    );

    // Look for objectness/confidence values
    const confidenceLogs = logs.filter(l =>
      l.text.includes('objectness') ||
      l.text.includes('Objectness') ||
      l.text.includes('confidence') ||
      l.text.includes('Confidence')
    );
    console.log('\n--- Objectness/Confidence Logs ---');
    confidenceLogs.forEach(l => console.log(l.text));

    console.log('\n--- Issue Detection ---');
    console.log(`Confidence values > 100%: ${hasConfidenceError ? 'YES - ISSUE FOUND' : 'No'}`);
    console.log(`Bounding box NaN/Infinity: ${hasBoundingBoxError ? 'YES - ISSUE FOUND' : 'No'}`);
    console.log(`Keypoint errors: ${hasKeypointError ? 'YES - ISSUE FOUND' : 'No'}`);

    // Check for detection count
    const detectionCountLogs = logs.filter(l =>
      l.text.includes('detection') || l.text.includes('Detection')
    );
    console.log('\n--- Detection Count Logs ---');
    detectionCountLogs.forEach(l => console.log(l.text));

    // Look for inference time logs
    const inferenceLogs = logs.filter(l => l.text.includes('Inference completed'));
    console.log('\n--- Inference Logs ---');
    inferenceLogs.forEach(l => console.log(l.text));

    // Take screenshot
    await page.screenshot({ path: 'test-result.png', fullPage: true });
    console.log('\nScreenshot saved to test-result.png');

  } catch (error) {
    console.error('Test failed:', error.message);

    // Take screenshot for debugging
    await page.screenshot({ path: 'test-error.png', fullPage: true });
    console.log('Screenshot saved to test-error.png');
  } finally {
    await browser.close();
  }
}

testPoseModel().catch(console.error);
