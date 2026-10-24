# SPDX-License-Identifier: GPL-2.0-or-later
"""Presentation adapters for native screens that are not selector lists.

These adapters read existing controllers and invoke existing screen callbacks.
They do not implement routing, parameter rules, engines or persistence.
"""
import math


def native_controls(screen):
    controls = getattr(screen, "zcontrollers", None)
    if controls is not None:
        return list(enumerate(controls))
    widgets = getattr(screen, "zgui_ctrls", None)
    if widgets is None:
        widgets = getattr(screen, "zgui_controllers", [])
    return [(i, getattr(widget, "zctrl", None)) for i, widget in enumerate(widgets)]


def add_controls(adapter, screen, items):
    options_callback = getattr(screen, "controller_options", None)
    for i, control in native_controls(screen):
        if control is None:
            continue
        options = (lambda i=i: options_callback(i)) if callable(options_callback) else None
        adapter._add(items, f"control:{i}", control.name, control=control,
                     identity=id(control), options=options)
    # Selectors may have a second native controller outside the page array
    # (e.g. the MIDI player's loop toggle).
    secondary = getattr(screen, "zgui_ctrl2", None)
    control = getattr(secondary, "zctrl", None)
    if control is not None and all(control is not value for _, value in native_controls(screen)):
        adapter._add(items, "control:secondary", control.name, control=control, identity=id(control))


def widget_readouts(screen):
    """Read the same engine monitor values as native custom widgets."""
    widget = getattr(screen, "current_widget", None)
    monitors = getattr(widget, "monitors", None)
    if not isinstance(monitors, dict):
        return {}
    values = {}
    for key, value in list(monitors.items())[:128]:
        if type(value) in (int, float) and math.isfinite(value):
            values[str(key)] = round(value, 4)
        elif type(value) in (str, bool):
            values[str(key)] = str(value)[:1024]
    return values


def canvas_text(canvas):
    if canvas is None:
        return ""
    return "\n".join(canvas.itemcget(item, "text") for item in canvas.find_all()
                     if canvas.type(item) == "text")[:32768]


def special_screen(adapter, name, screen, state):
    """Populate a registered non-list view; return False for unknown view types."""
    items = state["items"]
    if name == "control_xy":
        manager = adapter.gui.state_manager
        for axis in ("x", "y"):
            control = getattr(manager, "zctrl_" + axis, None)
            if control is not None:
                adapter._add(items, "axis:" + axis, axis.upper() + " · " + control.name,
                             control=control, identity=id(control))
        state["content"] = {"type": "xy", "text": "Adjust the assigned X and Y parameters."}
    elif name in ("midi_key_range", "midi_cc_range", "brightness_config", "cv_config", "control_test"):
        add_controls(adapter, screen, items)
        if name == "midi_key_range":
            state["content"] = {"type": "keyRange", "low": screen.note_low, "high": screen.note_high,
                                "text": f"MIDI notes {screen.note_low}–{screen.note_high} · Transpose applies to this chain."}
            adapter._add(items, "range:learn", "Stop MIDI learn" if screen.learn_mode else "Learn key range from MIDI",
                         lambda t: screen.toggle_midi_learn())
        elif name == "midi_cc_range":
            state["content"] = {"type": "ccRange", "text": "Map incoming MIDI CC minimum and maximum to these parameter values."}
        elif name == "control_test":
            state["content"] = {"text": canvas_text(screen.test_canvas)}
        elif not items:
            state["message"] = "No compatible hardware controls are available on this host."
        adapter._add(items, "panel:done", "Done", lambda t: adapter.gui.cuia_back())
    elif name == "info":
        state["content"] = {"text": screen.textarea.get("1.0", "end-1c")[:32768]}
        adapter._add(items, "info:close", "Close", lambda t: adapter.gui.cuia_back())
    elif name == "help":
        soup = getattr(screen, "soup", None)
        body = (soup.body or soup) if soup is not None else None
        state["content"] = {"text": body.get_text("\n", strip=True)[:65536] if body else "Choose a help topic."}
        for i, (href, label) in enumerate(screen.links):
            adapter._add(items, f"help:{i}", label or href,
                         lambda t, href=href: screen.link_cb(href), identity=href)
    elif name == "touchscreen_calibration":
        state["content"] = {"text": canvas_text(screen.canvas) + "\nCalibration requires touching the physical Zynthian display."}
        adapter._add(items, "calibration:cancel", "Cancel calibration", lambda t: adapter.gui.cuia_back())
    elif name == "splash":
        state["message"] = "Zynthian is starting or stopping."
    elif name == "none":
        state["message"] = "Choose a view from the navigation menu."
    else:
        return False
    return True


def navigation_actions(gui):
    routes = (
        ("chainManager", "Chain Manager", "cuia_screen_chain_manager"),
        ("addChain", "Add Chain", "cuia_add_chain"),
        ("chainControl", "Chain Control", "cuia_chain_control"),
        ("presets", "Banks / Presets", "cuia_bank_preset"),
        ("zs3", "ZS3", "cuia_screen_zs3"),
        ("tempo", "Tempo", "cuia_tempo"),
        ("audioPlayer", "Audio Player", "cuia_screen_audio_player"),
        ("midiPlayer", "MIDI Player / Recorder", "cuia_screen_midi_recorder"),
        ("audioLevels", "Audio Levels", "cuia_screen_alsa_mixer"),
        ("midiInput", "MIDI Input", "midi_in_config"),
        ("midiOutput", "MIDI Output", "midi_out_config"),
        ("admin", "Administration", "cuia_screen_admin"),
    )
    return {key: (label, getattr(gui, method)) for key, label, method in routes
            if callable(getattr(gui, method, None))}


def contextual_actions(gui, screen, name=None):
    result = {}
    menu = getattr(screen, "show_menu", None) or getattr(screen, "item_menu", None)
    if callable(menu):
        result["screenMenu"] = ("Screen options", menu)
    player = getattr(getattr(gui, "state_manager", None), "audio_player", None)
    if name == "audio_player" or (name == "control" and player is not None and getattr(gui, "current_processor", None) is player):
        result["audioFiles"] = ("Files / recordings", gui.cuia_bank_preset)
        result.pop("screenMenu", None)
    if getattr(screen, "moving_chain", None) or getattr(screen, "moving_proc", None):
        for direction in ("left", "right", "up", "down"):
            callback = getattr(screen, "arrow_" + direction, None)
            if callable(callback):
                result["move:" + direction] = ("Move " + direction, callback)
        result["move:done"] = ("Finish moving", lambda: screen.switch_select("S"))
    if name == "zs3":
        result["zs3Learn"] = ("Stop program learn" if gui.state_manager.midi_learn_state else "Learn program change", screen.toggle_midi_learn)
        if getattr(screen, "moving_zs3", None):
            result["move:up"] = ("Move up", lambda: screen.nudge_zs3(-1))
            result["move:down"] = ("Move down", lambda: screen.nudge_zs3(1))
            result["move:done"] = ("Finish moving", screen.end_moving_zs3)
        result["zs3Previous"] = ("Previous ZS3", lambda: gui.state_manager.load_prev_zs3(True))
        result["zs3Next"] = ("Next ZS3", lambda: gui.state_manager.load_next_zs3(True))
    if getattr(screen, "midi_learning", 0):
        result["cancelLearn"] = ("Cancel MIDI learn", screen.exit_midi_learn)
    if name == "midi_recorder" and gui.state_manager.status_midi_player:
        result["stopMidi"] = ("Stop MIDI playback", gui.state_manager.stop_midi_playback)
    if callable(getattr(gui, "show_help", None)):
        def open_help():
            gui.show_help("index:")
            # HTML content is already available to this adapter. Do not depend
            # on a Tk HTML renderer's version-specific loading event to navigate.
            gui.show_screen("help")
        result["help"] = ("Help", open_help)
    return result
