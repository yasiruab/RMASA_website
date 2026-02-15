"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { WhatsAppCta } from "@/components/whatsapp-cta";

type RoomOption = {
  id: string;
  title: string;
  summary: string;
  bestFor: string;
};

const rooms: RoomOption[] = [
  {
    id: "main-arena",
    title: "Main Arena",
    summary: "Ideal for tournaments, performances, seminars and large-format programs.",
    bestFor: "Best for high-capacity events and competitive sports formats.",
  },
  {
    id: "studio-room",
    title: "Studio Room",
    summary: "Suitable for rehearsals, workshops, training blocks and focused sessions.",
    bestFor: "Best for repeat practice, private sessions and smaller groups.",
  },
];

export function GuidedBookingFlow() {
  const router = useRouter();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [hasTriedContinue, setHasTriedContinue] = useState(false);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [selectedRoomId],
  );

  function onContinue() {
    if (!selectedRoomId) {
      setHasTriedContinue(true);
      return;
    }

    router.push(`/contact?space=${encodeURIComponent(selectedRoomId)}`);
  }

  if (rooms.length === 0) {
    return (
      <div className="booking-empty-state" role="status">
        Booking options are currently unavailable. Please contact us directly.
      </div>
    );
  }

  return (
    <div className="guided-booking">
      <div className="booking-grid">
        {rooms.map((room) => {
          const isSelected = room.id === selectedRoomId;

          return (
            <article className={`booking-card booking-select-card ${isSelected ? "selected" : ""}`} key={room.id}>
              <h2>{room.title}</h2>
              <p>{room.summary}</p>
              <p className="booking-best-for">{room.bestFor}</p>
              <button
                aria-pressed={isSelected}
                className={`btn ${isSelected ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setSelectedRoomId(room.id)}
                type="button"
              >
                {isSelected ? "Selected" : `Select ${room.title}`}
              </button>
            </article>
          );
        })}
      </div>

      <div className="booking-flow-actions">
        <p className="booking-selection-state" role="status">
          {selectedRoom ? `Selected: ${selectedRoom.title}` : "Select one room to continue."}
        </p>
        <button className="btn btn-primary" onClick={onContinue} type="button">
          Continue to Enquiry
        </button>
        <WhatsAppCta
          className="btn btn-secondary"
          message={
            selectedRoom
              ? `Hi Royal MAS Arena, I want to enquire about ${selectedRoom.title}.`
              : undefined
          }
        />
        {hasTriedContinue && !selectedRoom ? (
          <p className="form-message error" role="alert">
            Please select a room before continuing.
          </p>
        ) : null}
      </div>
    </div>
  );
}
