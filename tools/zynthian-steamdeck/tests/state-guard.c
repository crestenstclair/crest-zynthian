/* Test-only LV2: widen run/restore windows to detect unsafe host overlap.
 * Deliberately sleeps; this fixture is not a real-time audio plugin. */
#define _POSIX_C_SOURCE 200809L
#include <lv2/atom/atom.h>
#include <lv2/core/lv2.h>
#include <lv2/state/state.h>
#include <lv2/urid/urid.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define GUARD_URI "urn:crest-zynthian:test:state-guard"
typedef struct {
  atomic_int running, restoring, overlaps, restores;
  LV2_URID integer, path_type, overlap_key, restore_key, memory_key, asset_key, asset_value_key;
  int32_t memory, asset_value;
  char* asset_path;
  float* output;
} Guard;

static void widen_window(void) {
  const struct timespec delay = {0, 4000000};
  nanosleep(&delay, NULL);
}
static LV2_Handle instantiate(const LV2_Descriptor* d, double rate,
                             const char* path, const LV2_Feature* const* features) {
  (void)d; (void)rate; (void)path;
  const LV2_URID_Map* map = NULL;
  for (size_t i = 0; features && features[i]; ++i)
    if (!strcmp(features[i]->URI, LV2_URID__map)) map = features[i]->data;
  if (!map) return NULL;
  Guard* self = calloc(1, sizeof(Guard));
  if (!self) return NULL;
  atomic_init(&self->running, 0); atomic_init(&self->restoring, 0);
  atomic_init(&self->overlaps, 0); atomic_init(&self->restores, 0);
  self->integer = map->map(map->handle, LV2_ATOM__Int);
  self->path_type = map->map(map->handle, LV2_ATOM__Path);
  self->overlap_key = map->map(map->handle, GUARD_URI "#overlaps");
  self->restore_key = map->map(map->handle, GUARD_URI "#restores");
  self->memory_key = map->map(map->handle, GUARD_URI "#memory");
  self->asset_key = map->map(map->handle, GUARD_URI "#asset");
  self->asset_value_key = map->map(map->handle, GUARD_URI "#asset_value");
  self->asset_path = malloc(strlen(path) + 16);
  if (!self->asset_path) { free(self); return NULL; }
  sprintf(self->asset_path, "%sresource.bin", path);
  self->asset_value = 0x12345678;
  return self;
}
static void connect_port(LV2_Handle instance, uint32_t port, void* data) {
  if (port == 0) ((Guard*)instance)->output = data;
}
static void run(LV2_Handle instance, uint32_t frames) {
  Guard* self = instance;
  atomic_store(&self->running, 1);
  if (atomic_load(&self->restoring)) atomic_fetch_add(&self->overlaps, 1);
  widen_window();
  if (atomic_load(&self->restoring)) atomic_fetch_add(&self->overlaps, 1);
  if (self->output) memset(self->output, 0, frames * sizeof(float));
  atomic_store(&self->running, 0);
}
static LV2_State_Status save(LV2_Handle instance, LV2_State_Store_Function store,
                            LV2_State_Handle handle, uint32_t flags,
                            const LV2_Feature* const* features) {
  (void)flags; (void)features;
  Guard* self = instance;
  const int32_t overlaps = atomic_load(&self->overlaps);
  const int32_t restores = atomic_load(&self->restores);
  const uint32_t portable = LV2_STATE_IS_POD | LV2_STATE_IS_PORTABLE;
  LV2_State_Status status = store(handle, self->overlap_key, &overlaps,
                                sizeof(overlaps), self->integer, portable);
  if (status) return status;
  status = store(handle, self->restore_key, &restores,
                 sizeof(restores), self->integer, portable);
  if (status) return status;
  status = store(handle, self->memory_key, &self->memory,
                 sizeof(self->memory), self->integer, portable);
  if (status) return status;
  status = store(handle, self->asset_value_key, &self->asset_value,
                 sizeof(self->asset_value), self->integer, portable);
  if (status) return status;
  const LV2_State_Map_Path* paths = NULL;
  for (size_t i = 0; features && features[i]; ++i)
    if (!strcmp(features[i]->URI, LV2_STATE__mapPath)) paths = features[i]->data;
  if (!paths) return LV2_STATE_ERR_NO_FEATURE;
  char* abstract = paths->abstract_path(paths->handle, self->asset_path);
  if (!abstract) return LV2_STATE_ERR_UNKNOWN;
  status = store(handle, self->asset_key, abstract, strlen(abstract) + 1,
                 self->path_type, portable);
  free(abstract);
  return status;
}
static LV2_State_Status restore(LV2_Handle instance, LV2_State_Retrieve_Function get,
                               LV2_State_Handle handle, uint32_t flags,
                               const LV2_Feature* const* features) {
  (void)get; (void)handle; (void)flags; (void)features;
  Guard* self = instance;
  atomic_store(&self->restoring, 1);
  if (atomic_load(&self->running)) atomic_fetch_add(&self->overlaps, 1);
  widen_window();
  if (atomic_load(&self->running)) atomic_fetch_add(&self->overlaps, 1);
  size_t size = 0;
  uint32_t type = 0, property_flags = 0;
  const int32_t* memory = get(handle, self->memory_key, &size, &type, &property_flags);
  if (memory && size == sizeof(*memory) && type == self->integer)
    self->memory = *memory;
  else
    ++self->memory;
  const char* asset = get(handle, self->asset_key, &size, &type, &property_flags);
  if (asset && size && asset[size - 1] == '\0' && type == self->path_type) {
    const LV2_State_Map_Path* paths = NULL;
    for (size_t i = 0; features && features[i]; ++i)
      if (!strcmp(features[i]->URI, LV2_STATE__mapPath)) paths = features[i]->data;
    char* absolute = paths ? paths->absolute_path(paths->handle, asset) : NULL;
    self->asset_value = 0;
    FILE* file = absolute ? fopen(absolute, "rb") : NULL;
    if (file) {
      if (fread(&self->asset_value, sizeof(self->asset_value), 1, file) != 1)
        self->asset_value = 0;
      fclose(file);
    }
    if (absolute) { free(self->asset_path); self->asset_path = absolute; }
  }
  atomic_fetch_add(&self->restores, 1);
  atomic_store(&self->restoring, 0);
  return LV2_STATE_SUCCESS;
}
static const void* extension_data(const char* uri) {
  static const LV2_State_Interface state = {save, restore};
  return !strcmp(uri, LV2_STATE__interface) ? &state : NULL;
}
static void cleanup(LV2_Handle instance) {
  Guard* self = instance;
  free(self->asset_path);
  free(self);
}
static const LV2_Descriptor descriptor = {
  GUARD_URI, instantiate, connect_port, NULL, run, NULL, cleanup, extension_data
};
LV2_SYMBOL_EXPORT const LV2_Descriptor* lv2_descriptor(uint32_t index) {
  return index == 0 ? &descriptor : NULL;
}
