type AudioSource = "accessibility" | "socratic";

const activeAudioSources = new Set<AudioSource>();
const stopHandlers = new Set<() => void>();
const stateListeners = new Set<(active: boolean) => void>();

const emitState = () => {
  const active = activeAudioSources.size > 0;
  stateListeners.forEach((listener) => {
    try {
      listener(active);
    } catch {
      // Ignore listener errors so global audio state still propagates.
    }
  });
};

export const setGlobalAudioSourceActive = (source: AudioSource, active: boolean) => {
  if (active) {
    activeAudioSources.add(source);
  } else {
    activeAudioSources.delete(source);
  }
  emitState();
};

export const subscribeGlobalAudioState = (listener: (active: boolean) => void) => {
  stateListeners.add(listener);
  listener(activeAudioSources.size > 0);
  return () => {
    stateListeners.delete(listener);
  };
};

export const registerGlobalAudioStopHandler = (handler: () => void) => {
  stopHandlers.add(handler);
  return () => {
    stopHandlers.delete(handler);
  };
};

export const stopAllAudioPlayback = () => {
  stopHandlers.forEach((handler) => {
    try {
      handler();
    } catch {
      // Ignore stop handler errors so the rest of the audio sources can still stop.
    }
  });
};
