#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Build a self-contained illustrated manual from the actual frontend assets.

Every screenshot is rendered by Qt WebEngine with documentation fixtures.
No Zynthian backend, sound engine, or production fixture mode is introduced.
"""
import argparse
import ast
import base64
import html
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
from types import SimpleNamespace as NS
from unittest.mock import Mock
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[2])
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--phase', choices=['fixtures', 'manual'], required=True)
args = parser.parse_args()
repo = args.repo.resolve()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
(out/'screenshots').mkdir(exist_ok=True)
(out/'render-pages').mkdir(exist_ok=True)
spec = importlib.util.spec_from_file_location('bridge_fixtures', repo/'controller-webview/tests/test_bridge.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
ScreenAdapter = fixture.ScreenAdapter
SOURCE_COMMIT = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
UPSTREAM = 'f46b0189b6163472db39aa607369f397ed23b65a'
noop = lambda *a, **kw: None

def ctrl(name, value, lo=0, hi=127, labels=None, path=False):
    return NS(name=name, value=value, value_min=lo, value_max=hi, labels=labels,
              get_value2label=lambda:labels[int(value)] if labels else str(value),
              is_path=path, is_toggle=bool(labels and len(labels)==2), nudge=noop, toggle=noop)

def selector(title, labels, controls=None):
    return NS(title=title, list_data=[(None if label.startswith('>') else f'example:{i}', i, label)
                                     for i,label in enumerate(labels)],
              zcontrollers=controls or [], select=noop, switch_select=noop)

entries = []
def add(slug, name, screen, title, group, description, use, limit='', *, selected=0, gui_extra=None, **state_extra):
    gui = NS(current_screen=name, screens={name:screen}, cuia_back=noop, show_screen=noop,
             cuia_screen_mixer=noop, cuia_screen_snapshot=noop, cuia_all_sounds_off=noop)
    if gui_extra:
        gui.__dict__.update(gui_extra)
    state = ScreenAdapter(gui).snapshot()
    state.update(connected=True, selected=selected, busy=False, error='',
                 inputStatus='DOCUMENTATION FIXTURE · NO AUDIO')
    state.update(state_extra)
    entries.append(dict(slug=slug, title=title, group=group, description=description,
                        use=use, limit=limit, state=state))

menu = fixture.MainMenu()
menu.zyngui = Mock(capture_log_fname=False)
menu.state_manager = NS(audio_recorder=NS(status=False),status_midi_recorder=False)
menu.clean_menu = Mock()
menu.toggle_capture_log = Mock()
menu.config=menu._get_config()
add('01-main-menu','main_menu',menu,'Main menu','Navigation',
    'The four-column menu is taken directly from the checked-out upstream main-menu method. It is the starting point for chains, snapshots, routing, tempo, recording, administration and power.',
    'Start / Home opens this menu. Move with the D-pad or arrows; A / Enter invokes the original Zynthian action.',
    'A visible menu entry does not mean its destination has been ported. The complete screen inventory below marks those gaps.')
chain = fixture.Grid()
chain.columns=3
chain.title='Add Chain…'
chain.zyngui=Mock()
chain.zyngui.chain_manager.get_processor_count.return_value=0
chain.pos=0
fixture.upstream_method('zynthian_gui_add_chain.py','zynthian_gui_add_chain','reset_config')(chain)
add('02-add-chain','add_chain',chain,'Add a chain','Navigation',
    'All eight chain types come from Zynthian’s own Add Chain definition: Instrument, Audio Input, Clip Launcher, MIDI, MIDI + Audio, Audio Generator, Special and Mixbus.',
    'Choose the chain type; Zynthian decides the subsequent engine and MIDI-channel steps.',
    'The Clip Launcher chain uses Zynthian’s audio-clip engine; the performance grid is covered in the Sequencer section.')
add('03-engine-browser','engine',selector('MIDI Synth', ['ZynAddSubFX','Sfizz','LinuxSampler','setBfree','Aeolus','> Example catalog — installed engines vary']),
    'Engine browser','Instrument', 'Zynthian supplies its available engine list. The webview renders the selector and passes the chosen index back.',
    'A / Enter selects an engine. Y / F4 invokes that screen’s bold action, where implemented.',
    'This sample catalog is illustrative; it is not an installed-engine scan.')
add('04-midi-channel','midi_chan',selector('MIDI Channel', ['☒ MIDI CHANNEL 1']+[f'☐ MIDI CHANNEL {i}' for i in range(2,17)]),
    'MIDI-channel selection','Instrument','The selected channel and usage indicators are produced by the native MIDI-channel selector.',
    'Select the channel used by your external MIDI controller. Page Up / Page Down moves through long lists.',
    'The gamepad controls menus; it does not produce musical notes.')
add('05-bank-browser','bank',selector('ZynAddSubFX / Bank', ['Example bank A','Example bank B','Example user bank']),
    'Bank browser','Instrument','Banks are supplied by the selected Zynthian processor.',
    'Choose a bank, then choose a preset in the following selector.', 'Names shown here are documentation examples.')
add('06-preset-browser','preset',selector('ZynAddSubFX / Example bank A', ['Example preset 01','Example preset 02','Example preset 03','Example preset 04','Example preset 05','Example preset 06']),
    'Preset browser','Instrument','The native preset list is displayed without creating a new preset format or sound engine.',
    'A / Enter activates the selected preset. The result and next screen are controlled by Zynthian.',
    'Loading and audio playback have not been validated. Composite Chain Control is now adapted.',selected=1)
params=[ctrl('volume',96),ctrl('panning',64),ctrl('filter cutoff',80),ctrl('filter resonance',32)]
add('07-parameter-editing','control',selector('ZynAddSubFX / main',['> Parameter pages','main','mode','portamento','modulation','pitchwheel'],params),
    'Standalone parameter page','Instrument','The first four names match ZynAddSubFX’s native main control page. The values are examples. Current-page controls appear above the page list.',
    'Select a parameter with up/down; left/right nudges it. Hold LB / Shift for the native fine step. Choose another page below.',
    'This captures the standalone page; the composite Chain Control view is shown separately.',selected=2)
add('08-path-control','control',selector('Example file parameter',['> Parameter pages','Files'],[ctrl('Sample file','example.wav',0,1,path=True)]),
    'File / path parameter','Instrument','A path-valued native control is activated instead of nudged.',
    'A / Enter requests Zynthian’s file selector. Numeric +/- buttons are hidden for this item.',
    'The sample filename is illustrative; this does not load an audio file.')
nodes=[[[dict(title='MIDI input',chain_id=1,proc='midi_input')],
         [dict(title='ZynAddSubFX',chain_id=1,proc='Example processor')],
         [dict(title='Audio output',chain_id=1,proc='audio_out')],
         [dict(title='Chain options',chain_id=1,proc='chain_options')]],
       [[dict(title='MIDI input',chain_id=2,proc='midi_input')],
         [dict(title='Sfizz',chain_id=2,proc='Example processor')]]]
add('09-chain-manager','chain_manager',NS(title='Chain Manager',nodes=nodes,select_node=noop,switch_select=noop),
    'Chain Manager','Chains & mixer','The native graph is flattened into a list. Each row keeps its chain ID and original node-selection callback.',
    'Choose a routing node or processor to open its original options. Y / F4 sends a bold selection.',
    'Graph geometry is not rendered. Move/reorder modes need additional input forwarding and are not validated.')
add('10-chain-options','chain_options',selector('Example chain / Options', ['> PROCESSORS','Add MIDI-FX processor','Add Audio-FX processor','Clean MIDI Learn','> MANAGE','Move chain','Rename chain','Export chain as snapshot…','Remove chain']),
    'Chain options','Chains & mixer','Processor and chain-management actions use upstream selector callbacks. Entries depend on the selected chain.',
    'Select an action. Names are entered through the on-screen keyboard; destructive actions use Zynthian’s confirmation flow.',
    'Move modes and their custom visual feedback are incomplete.',selected=1)
add('11-processor-options','processor_options',selector('ZynAddSubFX / Options', ['> Manage this processor','Replace ZynAddSubFX','Randomize parameters','Clean MIDI-learn','Info','> Add to chain','Insert MIDI Processor','Insert Audio Processor']),
    'Processor options','Chains & mixer','These labels come from the native processor-options implementation; the available subset varies by processor type.',
    'Use A / Enter to invoke an option. Audio-effect processors may also expose bypass and removal.',
    'Info uses a custom information view that is not yet represented by the webview.',selected=1)
chains={}
for i,name in [(1,'Example pad'),(2,'Example keys'),(0,'Main mixbus')]:
    controls={'level':ctrl('level',0.8,0,1),'balance':ctrl('balance',0.0,-1,1),
              'mute':ctrl('mute',0,0,1,['off','on']),'solo':ctrl('solo',0,0,1,['off','on'])}
    chains[i]=NS(chain_id=i,get_name=lambda name=name:name,zynmixer_proc=NS(controllers_dict=controls))
add('12-mixer','mixer',NS(title='Mixer',launcher_mode=False),'Mixer','Chains & mixer',
    'Each chain appears with level, balance, mute and solo. The controls are the native mixer processor’s controllers.',
    'Left/right adjusts the focused value. A / Enter toggles mute or solo. Activating the chain-name row opens chain options.',
    'There are no signal meters or fader-strip graphics in this pass.',selected=1,
    gui_extra={'chain_manager':NS(chains=chains,set_active_chain_by_id=noop)})
add('13-audio-input','audio_in',selector('Capture Audio from…', ['☒ Audio input 1 (example interface)','☒ Audio input 2 (example interface)']),
    'Audio-input routing','Routing','Audio capture ports and connection marks are read from Zynthian’s selector.',
    'A / Enter invokes the native input toggle. Y / F4 may open applicable hardware-level controls.',
    'Port names are examples; no audio interface was probed.')
add('14-audio-output','audio_out',selector('Send Audio to…', ['> CHAINS','☒ Main mixbus','> AUDIO OUTPUT','☐ Output 1','☐ Output 2','☐ Outputs 1+2 (stereo)']),
    'Audio-output routing','Routing','The native output selector can include chain targets and physical outputs.',
    'Choose a destination to invoke Zynthian’s routing toggle.',
    'The webview does not create a separate JACK or audio-routing graph.',selected=1)
add('15-midi-input','midi_config',selector('MIDI Input', ['☒ Example USB keyboard','☐ Example MIDI interface','> Services','Network MIDI (example)']),
    'MIDI devices and routing','Routing','Zynthian discovers devices, describes their modes and decides how selections change routing.',
    'Select a device; use the original bold action for additional options where supported.',
    'Devices and statuses are illustrative. MIDI output uses the same selector family.')
add('16-midi-cc','midi_cc',selector('MIDI CC', ['1 — Modulation wheel','7 — Volume','10 — Pan','11 — Expression','64 — Sustain']),
    'MIDI CC selector','Routing','MIDI controller-number and program-number screens use the generic list adapter.',
    'Navigate and choose the requested value. The surrounding Zynthian workflow decides how it is applied.',
    'Range editors and key-range graphics are separate custom screens and remain incomplete.')
add('17-snapshots','snapshot',selector('Snapshots', ['Save New Snapshot','Load Default Snapshot','Last State','> Example saved snapshots','Example session A','Example session B']),
    'Snapshots','Sessions','The snapshot screen is delegated to Zynthian. This illustration demonstrates the selector and sample session entries.',
    'RB / F3 opens snapshots. Follow the native save/load options, keyboard and confirmation dialogs.',
    'Exact option labels depend on the current snapshot mode. Save/restore integration has not been run.')
add('18-zs3','zs3',selector('ZS3s', ['Save ZS3','Example state A','Example state B','Example state C']),
    'ZS3 subsnapshots','Sessions','ZS3 names and actions use the existing Zynthian state manager through its selector.',
    'Open ZS3s from the main menu, then choose the desired native action.',
    'Custom performance readouts and waiting-for-MIDI overlays are not transferred by the list adapter.')
add('19-zs3-options','zs3_options',selector('Example state / Options', ['Rename','Update','Delete','> Example restore options','Chains','Mixer','MIDI capture']),
    'ZS3 options','Sessions','The same list adapter displays a selected subsnapshot’s native options.',
    'Use A / Enter for the available option; the list’s actual contents come from the running Zynthian version.',
    'Labels shown are illustrative. State-restoration behavior is owned by Zynthian.')
keyboard=NS(title='Name snapshot',text='Example session',keys=list('1234567890qwertyuiopasdfghjkl;zxcvbnm,.#'),
            btn_space=40,btn_delete=41,btn_shift=42,btn_alt=43,btn_cancel=44,btn_enter=45,
            execute_key_press=noop,function=noop)
add('20-keyboard','keyboard',keyboard,'Naming / on-screen keyboard','Sessions',
    'The native keyboard’s current character list and special keys are presented as a controller-friendly grid.',
    'Navigate to characters and press A / Enter. Use Space, Delete, Shift, Symbols, Cancel and Save. The entered text appears above the grid.',
    'Physical-keyboard free typing is not implemented in this shell; use the on-screen keys.')
confirm=NS(title='Confirm',text=NS(get=lambda:'Do you really want to remove this chain?'),callback=noop,callback_params=1,switch_select=noop)
add('21-confirmation','confirm',confirm,'Confirmation','Sessions','A dedicated confirmation view presents Cancel first and Confirm second.',
    'A fresh confirmation starts on Cancel. Select Confirm deliberately to invoke the native callback.',
    'Grid-based confirmation menus, such as Clean, follow their own native menu layout.')
play=fixture.Grid();play.title='Play & Record';play.columns=2;play.config=menu.get_playrec_options()
add('22-play-record','grid_sel',play,'Play & Record','Utilities','The four native actions are audio recording, audio-player browsing, MIDI recording and MIDI-player browsing.',
    'Select the relevant action. The existing Zynthian recorder and player handle the result.',
    'The webview has no added audio recorder; recording and playback have not been tested on a live system.')
add('23-tempo','tempo',selector('Tempo',['> Parameter pages','Tempo'],[ctrl('Tempo',120,20,300),ctrl('Beats per bar',4,1,16)]),
    'Tempo controls','Utilities','Tempo is a special native control screen and follows the same parameter layout.',
    'Select the value and adjust left/right; LB / Shift requests the native fine step.',
    'Parameter values and page contents shown are examples.')
add('24-audio-levels','alsa_mixer',selector('Audio Levels',['> Parameter pages','Hardware'],[ctrl('Example playback level',80,0,100)]),
    'Hardware audio levels','Utilities','Hardware mixer controls use the standalone control-screen adapter.',
    'Adjust the exposed native control. Available controls depend on the audio device.',
    'This screenshot does not establish compatibility with Steam Deck speakers or headphone output.')
add('25-admin','admin',selector('Admin',['> MIDI','Program Change => Processor Presets','Global Transpose (None)','☐ Active MIDI channel','☐ MIDI-USB mapped by port','Channel Pressure => CC (NONE)','Test MIDI','> AUDIO','PFL Output (example)','ZynVoice']),
    'Administration','Utilities','The administration selector exposes current native settings and actions.',
    'Select settings normally. Some settings open inline value editors; others open custom screens.',
    'This is a generic list port. Wi-Fi, Bluetooth, updates and power actions have not been exercised.',selected=2)
inline=selector('Admin',['Global Transpose (None)','☐ Active MIDI channel'])
inline.param_editor_zctrl=ctrl('Global transpose',0,-24,24)
add('26-inline-editor','admin',inline,'Inline setting editor','Utilities','A native inline editor appears as an extra parameter row.',
    'Focus the editor, adjust left/right, then A / Enter invokes the native confirm/apply action.',
    'The editor belongs to the original Zynthian screen.',selected=2)
add('27-file-selector','file_selector',selector('Select file',['Example folder A','Example folder B','Example sample.wav']),
    'File selector','Utilities','Files and directories are shown by the generic selector adapter.',
    'Choose a folder or file; Zynthian resolves the path and invokes the caller.',
    'No files shown in this example were opened or sent anywhere.')
clean=fixture.Grid();clean.title='Confirm Clean';clean.columns=3
clean.config=[dict(title=t,action=noop) for t in ['Clean All Chains','Clean All Sequences','Clean All Chains & Sequences']]+[None]*3+[dict(title='Cancel',action=noop)]
add('28-clean','grid_sel',clean,'Clean menu','Utilities','Zynthian’s Clean menu groups its chain and sequence cleanup actions.',
    'Select the intended action carefully or use Cancel / Back.',
    'Unlike the dedicated Confirm dialog, this is a grid. Blank upstream cells are compacted; this first-pass grid does not automatically focus Cancel.')
add('29-busy','engine',selector('MIDI Synth',['ZynAddSubFX','Sfizz','LinuxSampler']),
    'Operation pending','Status','The frontend displays Working… while waiting for a command response and disables further commands.',
    'Wait for completion. Commands are not queued for replay.',
    'This is a simulated pending response, not a running engine load.',busy=True)
add('30-stale-error','preset',selector('Preset browser',['Example preset 01','Example preset 02']),
    'Stale-screen rejection','Status','Commands include a screen revision. If another action changes that screen first, the command is rejected.',
    'Review the refreshed screen, then make a new selection.',
    'This capture injects the expected error text; it is not a failed live session.',error='Screen changed; command discarded')
add('31-disconnected','starting',None,'Disconnected','Status','When there is no backend connection, controls are unavailable and the screen explains how to connect.',
    'Start the configured Zynthian process with its bridge enabled and verify the same socket path and OS user.',
    'The app retries the connection. It never substitutes a demo sound engine.',connected=False)
# Sequencer examples are synthetic boundary fixtures passed through the real adapter.
import sys
sys.path.insert(0, str(repo/'controller-webview/tests'))
from test_sequencer import pattern_fixture, launcher_fixture
parent=NS(subscreen=selector('Example chain / main',['main','modulation','pitchwheel'],params),
          subscreen_name='control',chain=None,select_subscreen=noop)
add('32-chain-control','chain_control',parent,'Composite Chain Control','Instrument',
    'The active embedded screen now exposes its native controls and pages. Routing tabs and processors use native subscreen selection.',
    'Choose a control and nudge it, or open a routing tab. Back follows Zynthian’s screen history.',
    'Custom processor graphics remain separate; live instrument loading still needs verification.',selected=6)
gui,launcher=launcher_fixture()
add('33-clip-launcher','launcher',launcher,'Clip and phrase launcher','Sequencer',
    'Pads show the active scene’s native chains, phrases, playback state, repeats and follow destinations. The audio column uses existing Clippy chains.',
    'D-pad or left stick selects. A launches/stops; Y opens a clip. Phrase arrangement opens native repeat/follow/clone/move/delete options.',
    'Touch selects a pad without launching it. These playback states are fixtures.',canvasFocus=True)
gui,notes,_=pattern_fixture()
add('34-piano-roll','pattern_editor',notes,'Piano roll and velocity lane','Sequencer',
    'A controller-first grid inspired by Korg Gadget on Switch: piano keys, sustained note bars, cursor, playhead and a velocity lane for the selected pitch.',
    'A toggles a note. Right stick left/right changes duration; up/down changes velocity. LB gives fine duration. Y opens full native note editing.',
    'The grid and native callbacks are implemented. Audio, physical-stick feel and live recording need target verification.',
    gui_extra={'toggle_pated':noop},canvasFocus=True)
gui,cc,_=pattern_fixture(True)
cc.selected_cell=[4,64]
add('35-cc-automation','pated_cc',cc,'CC automation editor','Sequencer',
    'Native CC events appear as bars. The selected CC, cursor value, interpolation state and playback position are shown.',
    'Left/right selects a step; up/down changes its value. A adds/removes an event. Previous/Next CC switches controller number; Options exposes interpolation.',
    'The CC editor uses upstream’s value-edit behavior. Native multi-event edit modes are disabled for CC.',
    gui_extra={'toggle_pated':noop},canvasFocus=True)
notes.edit_mode=2;notes.edit_param=1
add('36-note-editing','pattern_editor',notes,'Note parameters','Sequencer',
    'Native note editing includes duration, velocity, offset, stutter, play frequency and probability.',
    'Left/right chooses the parameter; up/down changes it. A finishes; B leaves edit mode. Undo and redo call the native pattern history.',
    'History and recording persistence need live verification.',gui_extra={'toggle_pated':noop},canvasFocus=True)
launcher.moving_phrase=True
add('37-phrase-move','launcher',launcher,'Arrange phrases','Sequencer',
    'Move mode forwards directions to the native phrase mover, preserving sequence data and follow relationships.',
    'Open Phrase arrangement → Move phrase. Up/down reorders; A completes; Back leaves move mode. Clone, insert and delete remain in the native menu.',
    'The legacy timeline arranger is not registered upstream. Current song arrangement uses phrases.',canvasFocus=True)
add('38-phrase-options','option',selector('Phrase options: Verse',[
    'Duration (AUTO)','Automate => Chorus (NEXT)','Tempo (NONE)','Beats per bar (4)','Rename (Verse)',
    '> MANAGE','Insert phrase','Clone phrase','Move phrase','Delete phrase']),
    'Phrase arrangement options','Sequencer','The native phrase-options selector supplies duration, follow actions, tempo, time signature and management actions.',
    'Choose a setting and use its inline editor. Deleting a phrase follows Zynthian’s confirmation flow.',
    'Labels shown are illustrative; available settings depend on the native phrase.',selected=1)
add('39-custom-screen-gap','xy',NS(title='XY Control'),'Remaining custom screens','Not ported',
    'Custom surfaces without an adapter retain an explicit message.', 'Use Back or Main Menu.',
    'XY controls, hardware calibration, help, detailed information and several custom overlays remain unported.')

notes.edit_mode=0
add('40-piano-context-menu','pattern_editor',notes,'Piano roll context menu','Sequencer',
    'Editing, recording, undo/redo and navigation live in a popover over the full-screen grid.',
    'Menu, F5, Tab, LB + Y or left-stick click opens it. D-pad selects an action; Back/Esc or a tap outside dismisses it.',
    'The menu changes for note editing, block selection and CC automation. Fixture render; live testing remains pending.',
    gui_extra={'toggle_pated':noop},canvasFocus=False)
launcher.moving_phrase=False
add('41-launcher-context-menu','launcher',launcher,'Launcher context menu','Sequencer',
    'Clip and phrase actions appear over the launcher without taking permanent space from its pads.',
    'Open Menu for editing, phrase arrangement, copy/paste, tempo and navigation. A choice returns focus to the grid.',
    'The screenshot is a documentation fixture.',canvasFocus=False)


# Functional UI proposals are isolated from the live adapter and explicitly labeled.
sys.path.insert(0, str(repo/'controller-webview/mockups'))
from build_preview import preview_html
mockup_specs = [
 ('42-tracker','tracker',None,'Tracker sequencer','Step rows expose note, MIDI channel, chord, velocity, length and three FX fields. Decimal values and note names are used throughout.','Click a cell or move with arrows and press Enter. Apply edits, Cancel discards them, Delete clears a step.'),
 ('43-euclidean','euclidean',None,'Euclidean sequencer','Four lanes distribute hits across the pattern. Each lane has rotation, note, velocity, gate, mute and optional manual pulse overrides.','Edit a lane to change hits and rotation. Tap a step to override it; Use preview copies the generated notes into the tracker.'),
 ('44-randomizer','randomizer',None,'Randomizer sequencer','Generate a repeatable note preview using a seed, density, pitch range, scale, velocity range and gate range.','Lock notes or rests before generating a variation. Rules opens generation settings; Use preview explicitly copies the result into the tracker.'),
 ('45-sequencer-type','tracker','type','Sequencer-type configuration','Choose Piano roll, Tracker, Euclidean or Randomizer from the compact type button or context menu.','Switching types preserves authored notes. Generators keep their own previews until Use preview is chosen.'),
 ('46-pattern-settings','tracker','settings','Pattern and step settings','Configure 1–64 steps, step length through 1/64, straight/triplet/dotted timing, BPM, swing, default gate, playback direction, root and scale.','Open the step-summary button or Menu → Pattern settings. Apply commits the draft; Cancel leaves the pattern unchanged. Shortening hides authored steps; extending restores them.'),
 ('47-tracker-step','tracker','step','Tracker step editor','A step popover edits note, MIDI channel (1–16), chord, velocity, note length and three FX slots.','Edit a cell, then Apply. Note length is measured in steps, separately from the pattern’s musical step length.'),
 ('48-euclidean-settings','euclidean','lane','Euclidean lane settings','Hits, rotation, note, velocity and gate are configured per lane. All lanes currently share the pattern step count.','Apply updates the pulse preview. Clear manual overrides resets hand-edited pulses only when Apply is chosen.'),
 ('49-randomizer-settings','randomizer','random','Randomizer generation settings','Seeded random generation validates pitch, velocity and gate bounds and filters generated pitches through the selected root and scale.','Apply & generate repeats the selected seed. Generate variation advances the seed; locked notes and rests retain their current values.')
]
for slug,view,menu,title,description,use in mockup_specs:
    entries.append(dict(slug=slug,title=title,group='Sequencer mockups',description=description,use=use,
        limit='Interactive in-memory mockup. No Zynthian command, audio or MIDI output. MIDI channel/chord/FX fields are editable design data; native execution is not implemented.',
        state={'items':[]},mockup={'view':view,'menu':menu}))
preview=preview_html(repo)
(out/'zynthian-sequencer-mockups.html').write_text(preview)


def embedded_page(entry):
    if 'mockup' in entry:
        return preview_html(repo, entry['mockup'])
    web=repo/'controller-webview/web'
    text=(web/'index.html').read_text()
    text=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', text)
    text=text.replace('<link rel="stylesheet" href="style.css">','<style>'+ (web/'style.css').read_text()+'</style>')
    text=re.sub(r'<script[^>]*></script>', '', text)
    state=json.dumps(entry['state'],ensure_ascii=False).replace('</','<\\/')
    script=(web/'app.js').read_text()
    script+='\nwindow.fixtureCalls=[];backend={state:JSON.stringify('+state+'),input(...a){fixtureCalls.push(a);if(["focus","menu","back"].includes(a[0])){const s=JSON.parse(this.state);s.canvasFocus=a[0]==="back"?true:s.canvasFocus===false;this.state=JSON.stringify(s);render()}},choose(...a){fixtureCalls.push(a);const s=JSON.parse(this.state);s.canvasFocus=true;this.state=JSON.stringify(s);render()},sequence(...a){fixtureCalls.push(a)}};bindActions();render();\n'
    script+="el('connection').textContent='DOCUMENTATION FIXTURE · '+el('connection').textContent;\n"
    text=text.replace('</head>','<style>.sequencing::after{content:"DOCUMENTATION FIXTURE · NO AUDIO";position:fixed;bottom:3px;left:50%;transform:translateX(-50%);font:9px system-ui;color:#d3c7ac;background:#20272cdd;padding:2px 6px;pointer-events:none;z-index:2}</style></head>')
    return text.replace('</body>','<script>'+script+'</script></body>')

def screen_inventory():
    tree=ast.parse((repo/'zyngui/zynthian_gui.py').read_text())
    cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='zynthian_gui')
    method=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='create_screens')
    classes={}
    for path in (repo/'zyngui').glob('zynthian_gui_*.py'):
        for node in ast.parse(path.read_text()).body:
            if isinstance(node,ast.ClassDef):
                classes[node.name]=[ast.unparse(b).split('.')[-1] for b in node.bases]
    def inherits(name,base,seen=None):
        seen=seen or set()
        if name==base:return True
        if name in seen:return False
        seen.add(name)
        return any(inherits(b,base,seen) for b in classes.get(name,[]))
    raw={}
    for node in ast.walk(method):
        if isinstance(node,ast.Assign):
            for target in node.targets:
                if isinstance(target,ast.Subscript) and ast.unparse(target.value)=='self.screens' and isinstance(target.slice,ast.Constant):
                    key=target.slice.value
                    value=node.value
                    raw[key]=ast.unparse(value.func) if isinstance(value,ast.Call) else value.slice.value
    rows=[]
    for name,value in sorted(raw.items()):
        cls=raw.get(value,value)
        if name in ('confirm','keyboard','chain_manager'):
            status='Dedicated adapter';note='Renderer and callbacks implemented; live validation pending.'
        elif name in ('mixer','root'):
            status='Partial adapter';note='Chain list + level/balance/mute/solo. No meters or strip graphics.'
        elif name in ('launcher','pattern_editor','pated_cc'):
            status='Sequencer adapter';note='Native clip / phrase navigation, note and CC editing, transport and options. Live validation pending.'
        elif name=='chain_control':
            status='Composite adapter';note='Embedded controllers and selectors; processor and routing navigation.'
        elif inherits(cls,'zynthian_gui_selector_grid'):
            status='Grid adapter';note='Native menu configuration and selection callbacks.'
        elif inherits(cls,'zynthian_gui_selector'):
            status='Generic selector';note='List data and callbacks; custom graphics/overlays are not covered.'
            if name in ('control','tempo','alsa_mixer','audio_player'):note='Current-page native controls + page selector; custom engine widgets omitted.'
        else:
            status='Not ported';note='Custom surface has no adapter; title/unavailable message only.'
        rows.append(dict(name=name,cls=cls,status=status,note=note))
    rows.append(dict(name='arranger',cls='zynthian_gui_arranger',status='Not registered',note='Screen creation is commented out in this upstream baseline.'))
    return rows

inventory=screen_inventory()
manifest=[]
for entry in entries:
    page=out/'render-pages'/f'{entry["slug"]}.html'
    page.write_text(embedded_page(entry))
    manifest.append(dict(html=str(page),png=str(out/'screenshots'/f'{entry["slug"]}.png'),width=1280,height=800))
(out/'capture-manifest.json').write_text(json.dumps(manifest,indent=2))
(out/'screen-reference.json').write_text(json.dumps({'source_commit':SOURCE_COMMIT,'upstream_commit':UPSTREAM,'fixture_notice':'Qt WebEngine captures of actual frontend HTML/CSS with synthetic documentation state. No live backend, audio or Steam Deck validation.','screens':entries,'inventory':inventory},ensure_ascii=False,indent=2))
if args.phase=='fixtures':
    print(f'Prepared {len(entries)} screen captures and {len(inventory)} inventory entries.')
    raise SystemExit(0)

# The second phase requires successful screenshots from capture.cpp.
for entry in entries:
    entry['png']=(out/'screenshots'/f'{entry["slug"]}.png').read_bytes()
    entry['uri']='data:image/png;base64,'+base64.b64encode(entry['png']).decode()
    qa=json.loads((out/'screenshots'/f'{entry["slug"]}.png.json').read_text())
    assert not qa['overflow'],entry['slug']
    assert qa['hasRenderer'],entry['slug']
    if 'mockup' not in entry:
        assert qa['items']==len(entry['state']['items']),entry['slug']

esc=lambda value:html.escape(str(value),quote=True)
def table(headers,rows):
    return '<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+esc(v)+'</th>' for v in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in row)+'</tr>' for row in rows)+'</tbody></table></div>'
def code(text):return '<pre><code>'+esc(text.strip())+'</code></pre>'
def image_tag(entry,cls=''):return f'<img class="{cls}" src="{entry["uri"]}" alt="{esc(entry["title"])} — documentation fixture" width="1280" height="800">'

controls=[('Sequencer play / stop','X','Space'),('Sequencer record','LB + X','R'),('Context menu','LB + Y','F5 / Menu'),('Open / close context menu','Left-stick click','Tab'),('Note length','Right stick left / right','[ / ]'),('Note velocity','Right stick up / down','− / ='),('Select block','Right-stick click','Menu → Select / copy block'),('Open sequencer','Sidebar','F6'),('Navigate','D-pad','Arrow keys'),('Select / activate','A','Enter'),('Back','B','Esc / Backspace'),('Native bold action / options','Y','F4'),('Adjust selected parameter','D-pad left / right','Left / right'),('Fine adjustment','Hold LB while adjusting','Hold Shift while adjusting'),('Main Menu','Start','Home'),('Mixer','View / Back','F2'),('Snapshots','RB','F3'),('All sounds off','Touch/click sidebar','F12'),('Page through a long list','—','Page Up / Page Down')]
build='''sudo apt install build-essential cmake pkg-config qt6-base-dev qt6-webengine-dev qt6-webchannel-dev libsdl2-dev
cmake -S controller-webview -B controller-webview/build -DCMAKE_BUILD_TYPE=Release
cmake --build controller-webview/build -j4
ctest --test-dir controller-webview/build --output-on-failure'''
launch='''# In the existing, working Zynthian environment, under the same OS user:
install -d -m 700 "$XDG_RUNTIME_DIR/zynthian-webview"
export ZYNTHIAN_WEBVIEW_SOCKET="$XDG_RUNTIME_DIR/zynthian-webview/control.sock"
python3 zynthian_main.py'''
frontend='''# Second terminal; same ZYNTHIAN_WEBVIEW_SOCKET value:
controller-webview/build/zynthian-controller \
  --socket "$ZYNTHIAN_WEBVIEW_SOCKET" --fullscreen'''
preview_uri='data:text/html;base64,'+base64.b64encode(preview.encode()).decode()
groups=list(dict.fromkeys(e['group'] for e in entries))
cards=[]
for e in entries:
    cards.append(f'''<article class="screen-card" id="screen-{e['slug']}" data-group="{esc(e['group'])}">
      <button class="screenshot-button" data-image="{e['slug']}" aria-label="Enlarge {esc(e['title'])}">{image_tag(e)}</button>
      <div class="card-body"><div class="card-meta">{e['slug'][:2]} / {esc(e['group'])}<a download="{e['slug']}.png" href="{e['uri']}">PNG ↗</a></div>
      <h3>{esc(e['title'])}</h3><p>{esc(e['description'])}</p><p class="how"><strong>Use:</strong> {esc(e['use'])}</p>
      <p class="limit">{esc(e['limit'])}</p></div></article>''')

content=f'''<section id="overview"><div class="eyebrow">CONTROLLER WEBVIEW / FIELD MANUAL</div><h1>Zynthian,<br>screen by screen.</h1>
<p class="lead">A visual reference for the current C++ / Qt controller frontend: what it shows, how to navigate it, and where the port stops.</p>
<div class="stats"><span><b>{len(entries)}</b> screenshots</span><span><b>{len(inventory)}</b> screen inventory entries</span><span><b>1280 × 800</b> capture size</span></div>
<div class="notice"><strong>Read these as interface captures, not live-system proof.</strong> Every image is rendered from the actual frontend HTML/CSS by Qt WebEngine with explicitly labeled documentation fixtures. Example engines, names, ports and values are not a scan of your hardware. No synth or audio backend was started.</div>
<button class="hero-image screenshot-button" data-image="01-main-menu" aria-label="Enlarge Main menu">{image_tag(entries[0])}</button>
<p class="caption">Actual frontend rendering · documentation state · main-menu labels extracted from upstream source</p>
<h2>Current shape of the project</h2><p>The C++ shell uses <strong>Qt 6 WebEngine + WebChannel</strong>; SDL2 supplies gamepad events. A local adapter reads the existing Zynthian screens and invokes their callbacks. Zynthian’s Python/Tk application, engine manager, native engines, MIDI routing and state management remain underneath. Tk still runs. This frontend introduces no sound engine and imports no Crest Synth or Crest Tracker code.</p>
<div class="notice amber"><strong>Implementation versus validation:</strong> Clip launching, phrase arrangement, piano-roll editing, CC automation and composite Chain Control now have adapters. This remains an experimental UI port: no live Zynthian audio session or physical controller has been validated, and other custom surfaces remain incomplete.</div></section>

<section id="controls"><div class="eyebrow">01 / OPERATION</div><h2>Controller, keyboard and touch</h2><p>Button names use the standard SDL gamepad layout. A physical controller and Steam Deck input have not been tested.</p>{table(['Action','Gamepad','Keyboard'],controls)}
<p>In lists, up/down moves between selectable rows. In grids, up/down moves by a row and left/right moves by one item. On a numeric parameter, left/right edits instead. Directional actions repeat while held; activation does not. Input state is cleared on focus loss and controller removal.</p>
<p>Touch or click a row to select and activate it. Numeric controls also show − and + buttons; mouse users can hold Shift for fine adjustments. Path-valued controls open a file selector instead. Text entry currently uses the on-screen character grid; free typing on a physical keyboard is not wired up.</p>
<h3>Read the screen</h3>{table(['Element','Meaning'],[('Highlighted border','Current C++ navigation focus.'),('Connection status','Connected, Working… or Disconnected appears on normal menus. Sequencer controls disable during commands; errors appear over the canvas. The fixture label is documentation only.'),('Dim / heading row','Nonselectable item; normal list navigation skips it.'),('Value at the right','A native control’s current display value.'),('Parameter bar','Touch/mouse − and + for the focused numeric control.'),('Navigation','The left sidebar serves normal menus. Sequencer views put navigation in Menu, leaving the canvas full size.'),('Error banner','A rejected command or connection error. Review the current screen before trying again.')])}</section>

<section id="workflows"><div class="eyebrow">02 / WORKFLOWS</div><h2>How the pieces connect</h2>
<div class="workflow-grid"><article><h3>Create an instrument chain</h3><ol><li>Open Main Menu → Add Chain → Instrument.</li><li>Follow Zynthian’s engine and MIDI-channel selectors.</li><li>Choose the bank and preset exposed by the processor.</li><li>Play through your external MIDI input.</li></ol><p class="limit">Target workflow; live playback is unverified. The subsequent composite Chain Control screen exposes its active native subscreen.</p></article>
<article><h3>Edit an exposed control</h3><ol><li>On a standalone control page, focus the parameter.</li><li>Use left/right to nudge it.</li><li>Hold LB / Shift for native fine adjustment.</li><li>Select a page listed beneath the controls to change the parameter group.</li></ol><p class="limit">Logarithmic values, labels and step sizes come from the native controller. Custom graphical widgets are omitted.</p></article>
<article><h3>Manage chains and routing</h3><ol><li>Open Chain Manager from Main Menu.</li><li>Select a chain node or processor.</li><li>Choose the relevant native option or routing destination.</li><li>Use Mixer for level, balance, mute and solo.</li></ol><p class="limit">The chain graph is flattened. Reordering and custom move-mode feedback are not complete.</p></article>
<article><h3>Save or recall a session</h3><ol><li>Open Snapshots using RB / F3.</li><li>Use the native save/load options.</li><li>Enter a name with the on-screen keyboard.</li><li>Review any overwrite or removal confirmation.</li></ol><p class="limit">Snapshot persistence belongs to Zynthian and needs live verification. ZS3 lists are available separately from Main Menu.</p></article></div>
<h3>Use the full editor</h3><p>The piano roll, CC editor and clip launcher use the entire workspace below a 44-pixel bar. Menu opens a context-sensitive popover over the grid: clip actions, note parameters, block actions or CC values, plus navigation. It never reduces the grid area. Open it with Menu, LB + Y, left-stick click, F5 or Tab. Back/Esc or a tap outside dismisses it; choosing an action returns to the grid. Inline numeric controls remain open for adjustment. Native options are inside Menu → Options.</p><h3>Sequence a phrase</h3><ol><li>Open Sequencer (F6). Select a chain and phrase, then Y to edit.</li><li>Move with D-pad or left stick. A toggles notes. Right stick adjusts length/velocity; LB gives fine length changes. Y opens the full native note-parameter editor.</li><li>X toggles playback; LB + X toggles MIDI recording. Menu → Options exposes length, resolution, quantization, swing, scale/chord settings, pattern files and MIDI import/export.</li><li>Choose Menu → Edit CC for automation. Select a step, change its value with up/down and use A to add/remove.</li><li>Return to the launcher. Phrase arrangement opens repeats, follow targets, tempo, cloning, moving and deletion. Up/down moves a phrase in move mode; A finishes.</li></ol><p>Touch selects grid cells; the ± Note or Launch button adds/removes notes or launches clips. The note grid shows up to 16 steps and 12 pitches, following the cursor. Page Up/Down moves by 16 steps. The velocity lane shows the selected pitch. This controller workflow draws inspiration from <a href="https://www.detune.co.jp/KORG_Gadget_User_Manual_en.html">Korg Gadget for Nintendo Switch</a>; mappings remain the Zynthian controller port’s own.</p><h3>Additional sequencer mockups</h3><p>Tracker, Euclidean and Randomizer are interactive UI mockups using the existing theme and compact layout. The type selector and pattern-settings popover are demonstrated alongside them. Edits, generation, locks, undo and visual playback work within the preview session; it sends no commands to Zynthian and produces no audio or MIDI. The tracker’s MIDI Channel column selects channels 1–16 per step; new and generated notes default to channel 1. Channel, chord and FX values are editable mockup data; native execution is not implemented.</p><p><a download="zynthian-sequencer-mockups.html" href="{preview_uri}">Download the interactive sequencer mockups</a> — self-contained HTML, opens offline.</p><h3>When the view is incomplete</h3><p>Use Back, Main Menu or Mixer to leave an unsupported screen. The existing Tk interface continues to run underneath; this frontend does not claim to replace every Zynthian interaction yet. A visible action may open a custom view that is only listed in the coverage table.</p></section>

<section id="gallery"><div class="eyebrow">03 / SCREEN ATLAS</div><h2>Every represented screen family</h2><p>Click an image to enlarge it. Use its PNG link to save the original 1280 × 800 capture. Search and category filters work offline.</p>
<div class="filters"><input id="gallery-search" type="search" placeholder="Search screenshots, features or limitations…" aria-label="Search screenshots"><select id="group-filter" aria-label="Filter screenshot category"><option value="">All categories</option>{''.join('<option>'+esc(g)+'</option>' for g in groups)}</select><span id="result-count">{len(entries)} screens</span></div>
<div class="screen-grid">{''.join(cards)}</div><p id="no-results" hidden>No matching screenshots. Clear the search or choose another category.</p></section>

<section id="coverage"><div class="eyebrow">04 / COVERAGE</div><h2>Complete registered-screen inventory</h2><p>This inventory is extracted from <code>create_screens()</code> in the checked-out upstream source, with the inactive arranger listed separately. “Adapter” means the bridge has a representation for that screen family; it does not mean an end-to-end live test passed. A generic selector can omit a screen’s custom graphics or overlays.</p>
{table(['Screen ID','Current coverage','Notes'],[(r['name'],r['status'],r['note']) for r in inventory])}
<h3>Known limitations worth keeping visible</h3><ul><li>Sequencer and composite Chain Control adapters require target testing with the running native engine.</li><li>XY control, range editors, info/help, loading details and calibration screens are not ported.</li><li>The mixer is a list of controls; it has no live meters or fader-strip layout.</li><li>Chain/processor move modes require more than a bold action: direction forwarding and corresponding state need further work.</li><li>Some ZS3 performance and MIDI-learning overlays are outside the list adapter.</li><li>The grid adapter compacts empty native cells. Clean’s grid does not inherit the dedicated confirmation dialog’s Cancel-first behavior.</li><li>The four-column upstream main menu currently wires its MIDI Output item to the MIDI-input handler. This adapter preserves that upstream callback; that item needs correction in the fork.</li><li>Screen titles and rows are serialized, but native icons and rich per-row help panels are not displayed.</li><li>Note previews use native Zynthian audition. No new audio engine, hardware integration, latency benchmark, SteamOS installer or standalone runtime has been added.</li></ul></section>

<section id="setup"><div class="eyebrow">05 / BUILD & CONNECT</div><h2>Run it beside a working Zynthian</h2><p>These commands target Debian/Ubuntu. They build the frontend; they do not install Zynthian’s engines, native libraries, JACK or a Steam Deck OS image.</p><h3>1. Build the frontend</h3>{code(build)}
<p>Requirements: a C++20 compiler, CMake 3.22+, Qt 6.4+ and SDL2. Tests also need Qt Test and Python 3. Build with <code>-DBUILD_TESTING=OFF</code> only when intentionally omitting the tests.</p>
<h3>2. Enable the optional bridge</h3>{code(launch)}<p>Use the environment in which this fork’s Zynthian already starts successfully. If a service starts it, configure the variable there and run this fork’s entrypoint; do not start a duplicate Zynthian instance. If <code>XDG_RUNTIME_DIR</code> is unset, choose an absolute directory owned by that user with mode 0700 and use its socket path in both processes.</p>
<h3>3. Launch the webview</h3>{code(frontend)}<p>Run the frontend as a normal desktop user with Chromium sandboxing enabled. Both processes must use the same OS user and socket path. Connecting a normal-user frontend to a root-run Zynthian service is not supported by this transport.</p>
<h3>Connection behavior</h3><p>The adapter creates one local Unix socket with mode 0600 inside a private directory. It accepts one client and exposes a fixed set of screen actions. It opens no TCP listener. Stale selections are rejected using a screen revision. After disconnection the frontend retries without replaying commands. A command timeout does not prove an action failed: it may already have completed.</p></section>

<section id="troubleshooting"><div class="eyebrow">06 / TROUBLESHOOTING</div><h2>What a symptom means</h2>
{table(['Symptom','Check / response'],[('Waiting for Zynthian','Confirm the existing Zynthian runtime starts, the opt-in variable is set there, both paths match and both processes use the same OS user.'),('Socket directory error','The parent directory must belong to the current user and have mode 0700.'),('Socket path already exists','Do not replace a live socket. Stop the owning process; remove a stale socket only after confirming that process ended.'),('Screen changed; command discarded','Another action or external controller changed the screen. Review it and select again.'),('Working… does not finish','The frontend waits up to 30 seconds. Investigate the existing Zynthian process and its engine logs; do not assume the previous action was rolled back.'),('Menu entry opens an unavailable screen','Consult the coverage table. Leave using Back, Main Menu or Mixer.'),('No controller connected','Keyboard and touch still work. SDL gamepad mapping and physical hardware behavior need target testing.'),('No audio','Check the existing Zynthian engine, preset, MIDI path, mixer and audio routing. This shell has no independent test synth.'),('Raw or unexpected numeric values','The webview uses the native control’s label or value; polished unit formatting has not been added.'),('Preset loading reaches Chain Control','The active native subscreen and processor/routing choices should appear. Custom graphics remain omitted; report any missing native controls.')])}</section>

<section id="validation"><div class="eyebrow">07 / EVIDENCE</div><h2>What has actually been checked</h2>
{table(['Area','Evidence'],[('C++ build','Built against Qt 6.4.2 and SDL2 2.30.0 on Ubuntu in the work environment.'),('Adapter tests','25 Python boundary tests passed, including upstream note-entry and clip-launch methods, sequencer guards, native transport/edit callbacks and composite controls.'),('C++ navigation','Two navigation/focus tests passed, including context-menu dismissal and focus across state updates. Initialization and cleanup also completed.'),('Socket-dependent tests','Four tests were explicitly skipped because local socket creation is blocked in this environment.'),('Webview rendering','Actual HTML/CSS/JavaScript rendered in Qt WebEngine with local fixtures. Launcher, piano roll and CC views pass layout and popover interaction checks at 1280×800, 800×600 and 640×480. No backend connection is attempted.'),('Sequencer mockup checks','DOM-driven edits, cancellation, type switching, 64-step access, Euclidean pulse generation, seed repeatability, locked steps, bounds validation, commit/undo and popup geometry pass at 1280×800, 800×600 and 640×480.'),('Live runtime / audio','Not validated against a running Zynthian session. Additional sequencer mockups have no backend integration.'),('Physical controller / Steam Deck','Not validated on hardware.')])}
<p>Rendering proves the visual surface can be drawn in this environment. It does not validate the C++↔socket↔Zynthian interaction, engine startup, MIDI, audio or persistence. The documentation capture tool uses offscreen rendering and a local-files-only request interceptor; its sandbox exception is confined to the isolated root-run rendering task and is not a frontend deployment instruction.</p>
<h3>Next target verification</h3><ol><li>Run the full tests on a Linux host where local sockets are available; require no skips.</li><li>Launch this fork with an existing working Zynthian runtime under the same user.</li><li>Verify engine → channel → bank → preset, then verify composite Chain Control, note/CC editing, undo/redo, recording and phrase arrangement.</li><li>Test external MIDI playback, native parameter changes, mixer and routing.</li><li>Save/reload a snapshot and ZS3; check both sound and restored controls.</li><li>Check controller hotplug, focus loss, held-button behavior, long engine loads and reconnection.</li><li>Complete the custom views and package the verified runtime for Steam Deck.</li></ol>
<h3>Source and reproducibility</h3><p>This manual describes source commit <code>{SOURCE_COMMIT}</code>, based on upstream <code>{UPSTREAM}</code>. The screenshots use the same <code>web/index.html</code>, <code>web/style.css</code> and <code>web/app.js</code> as the frontend. Documentation-only changes embed the assets and fixture state, and add the visible fixture label.</p>
<p>The screenshots ZIP includes original PNGs, a JSON reference containing fixture states and captions, and the capture/generation scripts. No screenshot claims to show a real user session. Upstream menu structures and callbacks are read from the checked-out source; representative preset names and device data are synthetic.</p>
{table(['Source file','Purpose'],[('controller-webview/src/input.cpp','Keyboard and SDL controller mapping.'),('controller-webview/src/model.cpp','C++ focus, command gating, protocol, connection state.'),('controller-webview/web/','Rendered interface assets.'),('zynwebview/bridge.py','Native screen serialization and callback delegation.'),('zynwebview/sequencer.py','Native sequencer view windows and editing delegation.'),('zyngui/zynthian_gui.py','Registered screen inventory.'),('zyngui/zynthian_gui_main_menu.py','Main menu and Play & Record definitions.'),('zyngui/zynthian_gui_add_chain.py','Chain-type menu.'),('controller-webview/tests/','Boundary and navigation/transport tests.')])}</section>'''

css='''*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:24px}body{margin:0;background:#f2f3ef;color:#16221e;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65}.sidebar{position:fixed;inset:0 auto 0 0;width:238px;background:#122921;color:#d4e4dc;padding:34px 24px;display:flex;flex-direction:column;z-index:2}.logo{font-weight:850;letter-spacing:3px;font-size:20px}.sublogo{font-size:10px;letter-spacing:2px;color:#96b7a7;margin-top:7px}.sidebar nav{margin-top:45px;display:flex;flex-direction:column;gap:5px}.sidebar a{color:#bdd0c6;text-decoration:none;padding:9px 10px;border-radius:5px;font-size:14px}.sidebar a:hover,.sidebar a.active{background:#25473a;color:white}.sidebar .meta{margin-top:auto;font-size:11px;color:#96b7a7}.sidebar button{padding:10px;margin-top:16px;background:#315443;border:1px solid #4a705b;color:white;border-radius:4px;cursor:pointer}main{max-width:1510px;margin-left:238px;padding:65px 64px 80px}section{margin:0 0 72px;padding-bottom:52px;border-bottom:1px solid #cdd6ce;scroll-margin-top:28px}.eyebrow{font-size:11px;letter-spacing:2px;font-weight:700;color:#426e57}h1{font-size:clamp(44px,5.2vw,76px);line-height:1.06;letter-spacing:-3px;font-weight:780;margin:18px 0 26px}h2{font-size:32px;line-height:1.23;letter-spacing:-.8px;margin:15px 0 20px}h3{font-size:20px;line-height:1.35;margin:22px 0 12px}p{margin:12px 0 18px}.lead{max-width:770px;font-size:21px;color:#4a5b51}.stats{display:flex;gap:36px;flex-wrap:wrap;margin:32px 0}.stats span{font-size:12px;color:#66756c}.stats b{display:block;font-size:26px;color:#1d3b2d;line-height:1.3}.notice{padding:18px 22px;border:1px solid #b6cfc0;background:#e5eee7;border-left:4px solid #477960;border-radius:5px;font-size:14px;margin:24px 0}.notice strong{display:block;margin-bottom:5px}.notice.amber{background:#f3ebd8;border-color:#d6bd87;border-left-color:#9d792f}.hero-image{margin-top:25px}.screenshot-button{padding:0;border:0;display:block;width:100%;background:#111;cursor:zoom-in;border-radius:7px;overflow:hidden;box-shadow:0 3px 12px #12292118}.screenshot-button img{display:block;width:100%;height:auto}.caption{font-size:11px;color:#63756b}.table-wrap{overflow:auto;margin:20px 0;border:1px solid #ccd7cf;border-radius:6px}table{width:100%;border-collapse:collapse;font-size:14px;text-align:left;line-height:1.5}th{background:#e0e8e1;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#42604d}td,th{padding:13px 16px;border-bottom:1px solid #d5ded6;vertical-align:top}tr:last-child td{border-bottom:0}td:first-child{font-weight:600;min-width:155px}tr:nth-child(even){background:#f8faf6}code{font:12px ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere;background:#e1e7e0;padding:2px 4px;border-radius:3px}pre{background:#12261e;color:#deebe1;overflow:auto;padding:22px;border-radius:6px;line-height:1.8}pre code{padding:0;background:transparent;color:inherit;white-space:pre;overflow-wrap:normal}.workflow-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.workflow-grid article{border:1px solid #c8d6cc;border-radius:7px;padding:8px 24px 18px;background:#f9fbf6}.workflow-grid ol{padding-left:21px}.limit{font-size:12px;color:#80602d;background:#f2ebdd;border-radius:4px;padding:10px 12px;line-height:1.6}.filters{display:flex;gap:10px;position:sticky;top:0;padding:12px 0;background:#f2f3eff0;backdrop-filter:blur(6px);z-index:1;margin-bottom:20px;align-items:center}.filters input,.filters select{font:inherit;font-size:13px;padding:12px;border:1px solid #afc3b5;background:white;border-radius:5px;min-width:0}.filters input{flex:1}.filters select{max-width:180px}#result-count{font-size:12px;white-space:nowrap;color:#506356}.screen-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}.screen-card{background:white;border:1px solid #ced8ce;border-radius:9px;overflow:hidden;box-shadow:0 2px 8px #17362107}.screen-card[hidden]{display:none}.screen-card .screenshot-button{border-radius:0;box-shadow:none}.card-body{padding:20px 22px}.card-body h3{margin:12px 0 10px;font-size:22px}.card-body p{font-size:14px;line-height:1.65}.card-body .limit{font-size:12px;margin-bottom:0}.card-meta{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#55745e;display:flex;justify-content:space-between}.card-meta a{color:#32654c;text-decoration:none;font-weight:bold}.how{color:#345a45}.modal{position:fixed;inset:0;z-index:100;background:#07110df2;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}.modal[hidden]{display:none}.modal img{max-width:100%;max-height:82vh;object-fit:contain;width:auto;height:auto}.modalbar{width:min(1280px,100%);display:flex;align-items:center;gap:15px;justify-content:space-between;color:#d9eadf;padding:12px 0;font-size:14px}.modalbar button,.modalbar a{font:inherit;padding:9px 16px;border:1px solid #698978;background:#203e2f;color:white;border-radius:4px;text-decoration:none;cursor:pointer}.modalbar span{flex:1}.topmobile{display:none}li{margin-bottom:8px}a{color:#32654c}@media(min-width:1700px){main{margin-right:auto}}@media(max-width:1100px){.sidebar{width:195px;padding:28px 17px}main{margin-left:195px;padding:44px 30px}.screen-grid{gap:16px}.card-body{padding:16px}.filters{flex-wrap:wrap}#result-count{display:none}}@media(max-width:760px){.sidebar{position:static;width:auto;padding:18px 20px;display:block}.sidebar nav{margin-top:12px;flex-direction:row;overflow:auto;gap:0;padding-bottom:4px}.sidebar nav a{white-space:nowrap;font-size:11px;padding:7px 9px}.sidebar .meta,.sidebar button,.sublogo{display:none}.logo{font-size:16px}main{margin-left:0;padding:34px 20px}.screen-grid,.workflow-grid{grid-template-columns:1fr}h1{font-size:49px;letter-spacing:-2px}.lead{font-size:18px}h2{font-size:27px}.stats{gap:22px}.stats b{font-size:21px}.notice{padding:14px 16px}.filters{position:static;align-items:stretch}.filters input{flex-basis:100%}.filters select{max-width:none;width:100%}td,th{padding:10px 12px}.modal{padding:8px}.modalbar{flex-wrap:wrap}.modalbar span{flex-basis:100%}section{margin-bottom:46px;padding-bottom:32px}.card-body{padding:20px}}@media print{.sidebar,.filters,.modal,.card-meta a{display:none!important}main{margin:0;padding:0}.screen-grid,.workflow-grid{display:block}.screen-card{break-inside:avoid;margin-bottom:20px;box-shadow:none}.screen-card[hidden]{display:block}section{break-before:page}.hero-image{max-width:680px}body{background:white;font-size:11px}h1{font-size:42px}.screen-card img{max-height:330px;object-fit:contain;background:#111}.table-wrap{overflow:visible}.notice,.limit{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'''
js='''"use strict";const cards=[...document.querySelectorAll('.screen-card')];const search=document.getElementById('gallery-search');const group=document.getElementById('group-filter');const modal=document.getElementById('image-modal');let focusBeforeModal;function filter(){let n=0;const q=search.value.toLocaleLowerCase();for(const card of cards){card.hidden=!(card.textContent.toLocaleLowerCase().includes(q)&&(!group.value||card.dataset.group===group.value));if(!card.hidden)n++}document.getElementById('result-count').textContent=n+' screens';document.getElementById('no-results').hidden=n>0}search.addEventListener('input',filter);group.addEventListener('change',filter);function closeModal(){modal.hidden=true;document.body.style.overflow='';focusBeforeModal?.focus()}for(const button of document.querySelectorAll('[data-image]')){button.addEventListener('click',()=>{const card=document.getElementById('screen-'+button.dataset.image);const image=card.querySelector('img');document.getElementById('modal-image').src=image.src;document.getElementById('modal-image').alt=image.alt;document.getElementById('modal-title').textContent=card.querySelector('h3').textContent+' · documentation fixture';document.getElementById('modal-download').href=image.src;document.getElementById('modal-download').download=button.dataset.image+'.png';focusBeforeModal=button;modal.hidden=false;document.body.style.overflow='hidden';document.getElementById('modal-close').focus()})}document.getElementById('modal-close').addEventListener('click',closeModal);modal.addEventListener('click',e=>{if(e.target===modal)closeModal()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if(e.key==='Tab'&&!modal.hidden){const links=[document.getElementById('modal-download'),document.getElementById('modal-close')];const first=links[0],last=links[1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});document.getElementById('print').addEventListener('click',()=>window.print());if('IntersectionObserver'in window){const observer=new IntersectionObserver(es=>{for(const e of es){if(e.isIntersecting){document.querySelectorAll('.sidebar nav a').forEach(a=>a.classList.toggle('active',a.hash==='#'+e.target.id))}}},{rootMargin:'-10% 0px -65% 0px'});document.querySelectorAll('main>section').forEach(s=>observer.observe(s))}'''
nav=[('overview','Overview'),('controls','Controls'),('workflows','Workflows'),('gallery','Screen atlas'),('coverage','Full coverage'),('setup','Build & connect'),('troubleshooting','Troubleshooting'),('validation','Validation & source')]
manual='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zynthian Controller — Visual Manual</title><style>'+css+'</style></head><body><aside class="sidebar"><div class="logo">ZYNTHIAN</div><div class="sublogo">CONTROLLER WEBVIEW</div><nav>'+''.join(f'<a href="#{i}">{label}</a>' for i,label in nav)+'</nav><div class="meta">SOURCE '+SOURCE_COMMIT[:7]+'<br>Offline visual reference<br>Fixture captures · 1280 × 800</div><button id="print">Print / save as PDF</button></aside><main>'+content+'</main><div class="modal" id="image-modal" hidden role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modalbar"><span id="modal-title"></span><a id="modal-download">Download PNG</a><button id="modal-close">Close ×</button></div><img id="modal-image" alt=""></div><script>'+js+'</script></body></html>'
(out/'zynthian-controller-manual.html').write_text(manual)

# Full-resolution screenshot bundle, including source states and reproducibility files.
readme=f'''Zynthian controller screenshots
{len(entries)} PNGs, each 1280 x 800.
All are Qt WebEngine renders of the actual frontend HTML/CSS/JS using documentation fixtures.
No live backend, sound engine, hardware controller or Steam Deck was exercised.
Source: {SOURCE_COMMIT}
See screen-reference.json for captions, limitations, fixture data and full screen inventory.
The HTML manual embeds every screenshot and works offline.
Capture code and generator are supplied in reproduce/. Run the generator against the matching source checkout.
'''
with zipfile.ZipFile(out/'zynthian-controller-screenshots.zip','w',zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('README.txt',readme)
    archive.write(out/'screen-reference.json','screen-reference.json')
    archive.write(out/'zynthian-sequencer-mockups.html','zynthian-sequencer-mockups.html')
    for e in entries:archive.write(out/'screenshots'/f'{e["slug"]}.png',f'screenshots/{e["slug"]}.png')
    for name in ('generate_manual.py','capture.cpp','README.md'):archive.write(repo/'controller-webview/docs'/name,f'reproduce/{name}')

# A compact visual contact sheet, with legible labels and an explicit fixture notice.
from PIL import Image, ImageDraw, ImageFont
font_path='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font=ImageFont.truetype(font_path,22);small=ImageFont.truetype(font_path,14)
chosen=['01-main-menu','33-clip-launcher','34-piano-roll','42-tracker','43-euclidean','44-randomizer','45-sequencer-type','46-pattern-settings','47-tracker-step','48-euclidean-settings','49-randomizer-settings','40-piano-context-menu']
sheet=Image.new('RGB',(1600,1330),'#e9eee7');draw=ImageDraw.Draw(sheet)
draw.text((28,20),'ZYNTHIAN CONTROLLER · SCREEN OVERVIEW',font=font,fill='#143b28')
draw.text((28,54),'Actual webview renders with documentation fixtures · no live Zynthian/audio validation',font=small,fill='#526758')
for i,slug in enumerate(chosen):
    e=next(x for x in entries if x['slug']==slug)
    im=Image.open(out/'screenshots'/f'{slug}.png').convert('RGB');im=im.resize((496,310),Image.Resampling.LANCZOS)
    x=28+(i%3)*522;y=90+(i//3)*305
    # Shorter thumbnails preserve source ratio while allowing readable labels.
    im.thumbnail((496,265),Image.Resampling.LANCZOS)
    sheet.paste(im,(x,y))
    draw.text((x,y+269),e['title'],font=small,fill='#183e2a')
sheet.save(out/'zynthian-controller-overview.png')
print(f'Wrote HTML manual ({len(manual):,} characters), screenshot ZIP and overview PNG.')
