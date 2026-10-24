// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QString>
#include <atomic>
#include <jack/jack.h>
#include <jack/ringbuffer.h>

// GUI producer, JACK consumer. Callback never allocates or waits for the GUI.
class MidiOutput {
public:
    MidiOutput();
    ~MidiOutput();
    bool send(int status,int note,int velocity);
    bool available() const;
    QString status() const;
private:
    static int process(jack_nframes_t frames,void* self);
    jack_client_t* client_ = nullptr;
    jack_port_t* port_ = nullptr;
    jack_ringbuffer_t* queue_ = nullptr;
    std::atomic<bool> alive_{false}, panic_{false};
    QString error_;
};
