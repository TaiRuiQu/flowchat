const participants = new Set<() => Promise<void>>()

export function registerCloseParticipant(participant: () => Promise<void>) {
  participants.add(participant)
  return () => {
    participants.delete(participant)
  }
}

export async function prepareWindowClose() {
  for (const participant of [...participants]) await participant()
}
