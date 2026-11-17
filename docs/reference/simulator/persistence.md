# Persistence

Storage, autosave, snapshots, and restore of simulator state.

Back to the [simulator reference](README.md) · [package README](../../../packages/simulator/README.md)

In the sample, `transport`, `clock`, and `station` are the values from the
[package README quick start](../../../packages/simulator/README.md#quick-start),
and `createWebStorage` comes from `@ocpptools/simulator/browser`.

Pass a `Storage` from `@ocpptools/core` to persist profile state, the offline
queue, and optionally history. Connection, boot, pending calls, metrics, clock
offset, timers, and in-flight scenarios are never stored.

```ts
const simulator = new Simulator201({
  url: 'wss://csms.example.com/CP001',
  transport,
  clock,
  station,
  persistence: {
    storage: createWebStorage(localStorage),
    key: 'cp001',
    autoSave: true,
    saveDebounceMs: 1000,
    includeHistory: true,
  },
});

const loaded = await simulator.load();
if (loaded.loaded) simulator.connect();

await simulator.save();
const snapshot = simulator.exportSnapshot();
const result = simulator.restoreSnapshot(snapshot);
```

In Node, use `createFileStorage('./state')` or `createMemoryStorage()` instead
of the Web Storage adapter.

`load()`, `save()`, and `restoreSnapshot()` never throw for expected storage or
snapshot failures; they return `LoadResult`, `SaveResult`, or `RestoreResult`
with an error snapshot. Invalid snapshots are rejected before state changes.
Restoring does not connect automatically. Autosave is debounced with the
injected scheduler and cancelled on dispose. Restored active transactions
restart their meter loops on the next ready transition; reservations are
rearmed by the profile.
