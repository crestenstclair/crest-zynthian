import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../web/input.mjs', import.meta.url), 'utf8');

async function harness(page, native, late = false) {
  await page.route('http://controller-input.test/**', route => {
    if (route.request().url().endsWith('input.mjs')) return route.fulfill({contentType:'text/javascript',body:source});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><input aria-label="Text field"><p id="status"></p>
      <script>
      window.actions=[]; window.gamepadPolls=0;
      window.pad={id:'Test browser controller',index:0,mapping:'standard',buttons:Array.from({length:17},()=>({pressed:false})),axes:[0,0,0,0]};
      Object.defineProperty(navigator,'getGamepads',{value:()=>{
        window.gamepadPolls++;
        if(window.gamepadError) throw new DOMException('Gamepad access denied','SecurityError');
        return [window.pad];
      }});
      window.createNative=()=>{
        const signal=()=>{let callback;return {connect:fn=>callback=fn,emit:(...args)=>callback?.(...args)}};
        window.zynthianNativeInput={status:'SDL · Test controller',actionTriggered:signal(),statusChanged:signal()};
        window.dispatchEvent(new Event('zynthian-native-ready'));
      };
      window.zynthianNativeHost=${native};
      if(${native && !late}) window.createNative();
      </script><script type="module">
      import {installInput} from './input.mjs';
      const model={view:{kind:'list'},inputStatus:'',notify(){document.querySelector('#status').textContent=this.inputStatus},input:(action,fine)=>window.actions.push({action,fine})};
      installInput(model);window.ready=true;
      </script>`});
  });
  await page.goto('http://controller-input.test/');
  await page.waitForFunction(()=>window.ready);
}

for (const late of [false,true]) test(`native input: WebChannel ${late?'late':'early'} handshake routes once and preserves text editing`,async({page})=>{
  await harness(page,true,late);
  if(late) {
    await expect(page.locator('#status')).toHaveText('Connecting native SDL input…');
    await page.evaluate(()=>window.createNative());
  }
  await expect(page.locator('#status')).toHaveText('SDL · Test controller');
  await page.evaluate(()=>window.zynthianNativeInput.actionTriggered.emit('record',true));
  expect(await page.evaluate(()=>window.actions)).toEqual([{action:'record',fine:true}]);
  expect(await page.evaluate(()=>window.gamepadPolls)).toBe(0);
  await page.evaluate(()=>{window.zynthianNativeInput.status='SDL · no controller connected';window.zynthianNativeInput.statusChanged.emit();});
  await expect(page.locator('#status')).toHaveText('SDL · no controller connected');
  await page.getByRole('textbox').fill('r home');
  await page.getByRole('textbox').press('ArrowLeft');
  expect(await page.evaluate(()=>window.actions.length)).toBe(1);
});

test('browser input: standard gamepad works without native host',async({page})=>{
  await harness(page,false);
  await expect(page.locator('#status')).toHaveText('Test browser controller');
  await page.waitForFunction(()=>window.gamepadPolls>=3);
  await page.evaluate(()=>window.pad.buttons[15].pressed=true);
  await expect.poll(()=>page.evaluate(()=>window.actions[0]?.action)).toBe('right');
  await page.evaluate(()=>window.pad.buttons[15].pressed=false);
  await page.waitForFunction(()=>window.gamepadPolls>5);
  await page.evaluate(()=>{window.pad.buttons[4].pressed=true;window.pad.buttons[2].pressed=true;});
  await expect.poll(()=>page.evaluate(()=>window.actions.at(-1))).toEqual({action:'record',fine:true});
});

test('browser input: reports missing and unsupported devices, then reconnects',async({page})=>{
  await harness(page,false);
  await expect(page.locator('#status')).toHaveText('Test browser controller');
  await page.evaluate(()=>{window.savedPad=window.pad;window.pad=null;});
  await expect(page.locator('#status')).toHaveText('Browser sees no controller · press a controller button');
  await page.evaluate(()=>{window.pad=window.savedPad;window.pad.mapping='';});
  await expect(page.locator('#status')).toHaveText('Unsupported browser mapping: Test browser controller');
  await page.evaluate(()=>{window.pad.mapping='standard';window.pad.buttons[15].pressed=true;});
  await expect(page.locator('#status')).toHaveText('Test browser controller · release buttons and center sticks');
  expect(await page.evaluate(()=>window.actions)).toEqual([]);
  await page.evaluate(()=>window.pad.buttons[15].pressed=false);
  await expect(page.locator('#status')).toHaveText('Test browser controller');
  await page.evaluate(()=>window.pad.buttons[15].pressed=true);
  await expect.poll(()=>page.evaluate(()=>window.actions[0]?.action)).toBe('right');
});

test('browser input: reports API failure and recovers without disabling keyboard',async({page})=>{
  await harness(page,false);
  await page.evaluate(()=>window.gamepadError=true);
  await expect(page.locator('#status')).toHaveText('Browser gamepad access failed: Gamepad access denied');
  await page.locator('body').press('ArrowRight');
  expect(await page.evaluate(()=>window.actions[0]?.action)).toBe('right');
  await page.evaluate(()=>window.gamepadError=false);
  await expect(page.locator('#status')).toHaveText('Test browser controller');
});
