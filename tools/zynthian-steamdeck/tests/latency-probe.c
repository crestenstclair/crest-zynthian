// Test-only LV2: distinguish a changing latency port from another output control.
#include <lv2/core/lv2.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct { float* ports[4]; } Probe;
static LV2_Handle instantiate(const LV2_Descriptor* d, double rate, const char* path,
                              const LV2_Feature* const* features) {
  (void)d; (void)rate; (void)path; (void)features;
  return calloc(1, sizeof(Probe));
}
static void connect_port(LV2_Handle handle, uint32_t index, void* data) {
  if (index < 4) ((Probe*)handle)->ports[index] = data;
}
static void run(LV2_Handle handle, uint32_t frames) {
  Probe* probe = (Probe*)handle;
  for (uint32_t i = 0; i < frames; ++i) probe->ports[0][i] = 0;
  *probe->ports[2] = *probe->ports[1];
  *probe->ports[3] = 999;
}
static const LV2_Descriptor descriptor = {
  "urn:crest-zynthian:test:latency-probe", instantiate, connect_port,
  NULL, run, NULL, free, NULL
};
LV2_SYMBOL_EXPORT const LV2_Descriptor* lv2_descriptor(uint32_t index) {
  return index ? NULL : &descriptor;
}
