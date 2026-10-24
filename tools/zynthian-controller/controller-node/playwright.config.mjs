import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests',testMatch:['live.spec.mjs','parity.spec.mjs'],workers:1,
  timeout:180000,use:{headless:true,viewport:{width:1280,height:800}},reporter:'list'});
