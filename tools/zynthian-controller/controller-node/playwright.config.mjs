import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests',testMatch:['live.spec.mjs','parity.spec.mjs','mapping.spec.mjs','input.spec.mjs','tracker-plan.spec.mjs','crest-live.spec.mjs','crest-controls.spec.mjs','responsive-controls.spec.mjs'],workers:1,
  timeout:180000,use:{headless:true,viewport:{width:1280,height:800}},reporter:'list'});
