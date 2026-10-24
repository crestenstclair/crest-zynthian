// SPDX-License-Identifier: GPL-2.0-or-later
#include "midi_output.hpp"
#include <jack/midiport.h>
#include <thread>
#include <chrono>
MidiOutput::MidiOutput() {
    client_=jack_client_open("zynthian_controller",JackNoStartServer,nullptr);
    if(!client_) { error_="JACK unavailable — editing only"; return; }
    queue_=jack_ringbuffer_create(65536);
    port_=jack_port_register(client_,"midi",JACK_DEFAULT_MIDI_TYPE,JackPortIsOutput|JackPortIsPhysical,0);
    if(!queue_ || !port_) { error_="Could not create MIDI output"; return; }
    jack_set_process_callback(client_,process,this);
    jack_on_shutdown(client_,[](void* pointer) { static_cast<MidiOutput*>(pointer)->alive_=false; },this);
    alive_=true;
    if(jack_activate(client_)!=0) { alive_=false; error_="Could not activate JACK client"; }
    // Zynthian autoconnect assigns physical MIDI inputs to its router device ports.
}
MidiOutput::~MidiOutput() {
    if(alive_) { panic_=true; std::this_thread::sleep_for(std::chrono::milliseconds(30)); jack_deactivate(client_); }
    if(client_) jack_client_close(client_);
    if(queue_) jack_ringbuffer_free(queue_);
}
bool MidiOutput::available() const { return alive_ && port_ && jack_port_connected(port_)>0; }
QString MidiOutput::status() const {
    if(!error_.isEmpty()) return error_;
    return available()?"MIDI connected through Zynthian router":"MIDI disconnected — check Zynthian routing";
}
bool MidiOutput::send(int status,int note,int velocity) {
    if(!available()) { panic_=true; return false; }
    const char packet[]{char(status),char(note),char(velocity)};
    if(jack_ringbuffer_write_space(queue_)<sizeof(packet)) { panic_=true; return false; }
    return jack_ringbuffer_write(queue_,packet,sizeof(packet))==sizeof(packet);
}
int MidiOutput::process(jack_nframes_t frames,void* pointer) {
    auto& self=*static_cast<MidiOutput*>(pointer);
    void* buffer=jack_port_get_buffer(self.port_,frames); jack_midi_clear_buffer(buffer);
    if(self.panic_.exchange(false)) {
        jack_ringbuffer_read_advance(self.queue_,jack_ringbuffer_read_space(self.queue_));
        for(int channel=0;channel<16;++channel) {
            const unsigned char packet[]{static_cast<unsigned char>(0xB0|channel),123,0};
            jack_midi_event_write(buffer,0,packet,3);
        }
        return 0;
    }
    unsigned char packet[3];
    while(jack_ringbuffer_read_space(self.queue_)>=3) {
        jack_ringbuffer_read(self.queue_,reinterpret_cast<char*>(packet),3);
        if(jack_midi_event_write(buffer,0,packet,3)!=0) { self.panic_=true; break; }
    }
    return 0;
}
