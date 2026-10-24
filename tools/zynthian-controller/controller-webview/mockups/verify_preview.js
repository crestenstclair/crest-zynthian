// Run with docs/capture.cpp's per-job script, after the packaged preview loads.
(()=>{
 const checks={};
 const assert=(name,value)=>{checks[name]=!!value;if(!value)throw new Error(name);};
 const enter=(name,value)=>{const field=el('field-'+name);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));};
 const apply=()=>el('apply-settings').click();
 try {
  assert('MIDI Channel replaces Instrument column',document.querySelector('.tracker-head').textContent.includes('MIDI Channel')&&!document.querySelector('.tracker-head').textContent.includes('Instrument'));
  assert('authored and generated events default to channel 1',[...mockup.events,...euclideanEvents(),...mockup.randomEvents].every(e=>e.channel===1&&!Object.hasOwn(e,'instrument')));
  document.querySelector('[data-step="4"] .tracker-cell:nth-child(3)').click();
  assert('channel selector offers exactly 1 through 16',JSON.stringify([...el('field-channel').options].map(o=>Number(o.value)))===JSON.stringify(Array.from({length:16},(_,i)=>i+1)));
  const beforeChannel=JSON.stringify(mockup.events);
  enter('channel',16);apply();
  assert('per-step channel edit',mockup.events.find(e=>e.step===4).channel===16&&mockup.events.filter(e=>e.step!==4).every(e=>e.channel===1)&&document.querySelector('[data-step="4"] .tracker-cell:nth-child(3)').textContent==='16');
  chooseAction('undo');assert('undo channel edit',JSON.stringify(mockup.events)===beforeChannel);
  chooseAction('redo');assert('redo channel edit',mockup.events.find(e=>e.step===4).channel===16);
  openMenu('step');enter('channel',1);closeMenu();assert('cancel channel draft',mockup.events.find(e=>e.step===4).channel===16);
  switchMode('notes');switchMode('tracker');assert('channel survives view switch',mockup.events.find(e=>e.step===4).channel===16);
  const original=JSON.stringify(mockup.events);
  el('sequencer-type').click();document.querySelector('[data-mode="euclidean"]').click();
  assert('type switch preserves notes',JSON.stringify(mockup.events)===original&&mockup.view==='euclidean');
  assert('four evenly spaced hits',JSON.stringify(Array.from({length:16},(_,i)=>i).filter(i=>pulse(mockup.euclidean[0],i)))==='[0,4,8,12]');
  document.querySelector('.lane-heading .seq-button').click();enter('hits',5);enter('rotation',2);apply();
  assert('lane settings apply',mockup.euclidean[0].hits===5&&mockup.euclidean[0].rotation===2&&euclideanEvents().filter(e=>e.pitch===36).length===5);
  const before=pulse(mockup.euclidean[0],0);document.querySelector('.pulse').click();
  assert('pulse override',pulse(mockup.euclidean[0],0)!==before);
  switchMode('tracker');mockup.cursor=4;render();document.querySelector('.cell-focus').click();enter('pitch',65);enter('velocity',91);enter('duration',1.5);apply();
  const edited=mockup.events.find(e=>e.step===4);assert('tracker edit',edited.pitch===65&&edited.velocity===91&&edited.duration===1.5&&edited.channel===16);
  openMenu('step');enter('velocity',24);closeMenu();assert('cancel discards draft',mockup.events.find(e=>e.step===4).velocity===91);
  const oldBounds=document.querySelector('.editor-surface').getBoundingClientRect();el('pattern-settings').click();
  const bounds=document.querySelector('.editor-surface').getBoundingClientRect(),pop=el('menu-panel').getBoundingClientRect();
  assert('popover leaves canvas unchanged',oldBounds.width===bounds.width&&oldBounds.height===bounds.height);
  assert('popover fits viewport',pop.left>=0&&pop.top>=44&&pop.right<=innerWidth&&pop.bottom<=innerHeight);
  enter('steps',64);enter('division',64);enter('tuplet','Triplet');apply();
  assert('step and division settings',mockup.config.steps===64&&mockup.config.division===64&&mockup.config.tuplet==='Triplet');
  mockup.cursor=63;mockup.page=3;render();assert('64th step reachable',document.querySelector('[data-step="63"]')!==null);
  openMenu('settings');enter('steps',8);apply();openMenu('settings');enter('steps',16);apply();
  assert('hidden authored steps retained',mockup.events.some(e=>e.step===14));
  switchMode('randomizer');openMenu('random');enter('seed',123);enter('density',100);enter('low',60);enter('high',72);enter('velocityLow',70);enter('velocityHigh',80);apply();
  assert('random generation bounds',mockup.randomEvents.length===16&&mockup.randomEvents.every(e=>e.pitch>=60&&e.pitch<=72&&e.velocity>=70&&e.velocity<=80&&scales[mockup.config.scale].includes(e.pitch%12)));
  const repeated=JSON.stringify(mockup.randomEvents);generateRandom();assert('seed repeatability',JSON.stringify(mockup.randomEvents)===repeated);
  document.querySelector('.lock-step').click();const locked=JSON.stringify(mockup.randomEvents.find(e=>e.step===0));chooseAction('regenerate');
  assert('locked note preserved',JSON.stringify(mockup.randomEvents.find(e=>e.step===0))===locked);
  openMenu('random');enter('low',80);enter('high',60);apply();assert('invalid ranges rejected',mockup.menu==='random'&&!!el('form-error').textContent);closeMenu();
  const authored=JSON.stringify(mockup.events),generated=JSON.stringify(mockup.randomEvents);chooseAction('bake');
  assert('explicit preview commit',mockup.view==='tracker'&&JSON.stringify(mockup.events)===generated);
  chooseAction('undo');assert('undo restores authored notes',JSON.stringify(mockup.events)===authored);
  openMenu('settings');enter('steps',0);apply();assert('invalid length rejected',mockup.menu==='settings'&&mockup.config.steps===16);closeMenu();
  openMenu('actions');el('context-dismiss').click();assert('outside dismissal',mockup.menu===null);
  checks.pass=true;
 }catch(error){checks.error=String(error);checks.pass=false;}
 window.manualChecks=checks;
})()
