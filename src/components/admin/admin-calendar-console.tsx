"use client";

import { useEffect, useMemo, useState } from "react";

type RoomType = {
  id: string;
  name: string;
  workingHours: { startTime: string; endTime: string };
};
type EventType = { id: string; name: string; durationHours: number; priority: number; roomTypeId?: string };
type PricingRule = {
  id: string;
  roomTypeId: string;
  eventTypeId: string;
  acMode: "with_ac" | "without_ac";
  dayType: "weekday" | "weekend" | "any";
  amountLkr: number;
};

type Booking = {
  id: string;
  roomTypeId: string;
  eventTypeId: string;
  acMode: "with_ac" | "without_ac";
  status: "pending" | "confirmed" | "tentative" | "rejected" | "cancelled_override";
  totalAmountLkr: number;
  reconciliationStatus: "unpaid" | "part_paid" | "paid" | "waived";
  reconciliationNotes: string;
  customer: { name: string; email: string; phone: string; purpose: string };
  slots: Array<{ date: string; startTime: string; endTime: string }>;
  createdAt: string;
};

type CalendarBlock = {
  id: string;
  roomTypeId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
};

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AdminCalendarConsole() {
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [blockForm, setBlockForm] = useState({
    roomTypeId: "",
    date: "",
    startTime: "07:00",
    endTime: "10:00",
    reason: "Maintenance",
  });

  useEffect(() => {
    void refreshAll();
  }, []);

  async function refreshAll() {
    const [configRes, bookingRes, blockRes] = await Promise.all([
      fetch("/api/admin/calendar/config"),
      fetch("/api/admin/calendar/bookings"),
      fetch("/api/admin/calendar/blocks"),
    ]);

    const configData = (await configRes.json()) as {
      rooms: RoomType[];
      eventTypes: EventType[];
      pricingRules: PricingRule[];
    };
    const bookingData = (await bookingRes.json()) as { bookings: Booking[] };
    const blockData = (await blockRes.json()) as { blocks: CalendarBlock[]; rooms: RoomType[] };

    setRooms(configData.rooms);
    setEventTypes(configData.eventTypes);
    setPricingRules(configData.pricingRules);
    setBookings(bookingData.bookings);
    setBlocks(blockData.blocks);
    setBlockForm((current) => ({
      ...current,
      roomTypeId: current.roomTypeId || configData.rooms[0]?.id || "",
    }));
  }

  async function saveConfig() {
    const res = await fetch("/api/admin/calendar/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rooms, eventTypes, pricingRules }),
    });

    const data = (await res.json()) as { message?: string };
    if (!res.ok) {
      setMessageTone("error");
      setMessage(data.message ?? "Failed to save configuration.");
      return;
    }

    setMessageTone("success");
    setMessage(data.message ?? "Configuration saved.");
    await refreshAll();
  }

  async function updateBookingStatus(id: string, status: Booking["status"]) {
    const res = await fetch("/api/admin/calendar/bookings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const data = (await res.json()) as { message?: string };
    setMessageTone(res.ok ? "success" : "error");
    setMessage(data.message ?? (res.ok ? "Booking updated." : "Failed to update booking."));
    await refreshAll();
  }

  async function updateReconciliation(
    id: string,
    reconciliationStatus: Booking["reconciliationStatus"],
    reconciliationNotes: string,
  ) {
    await fetch("/api/admin/calendar/bookings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, reconciliationStatus, reconciliationNotes }),
    });
    await refreshAll();
  }

  async function createBlock() {
    const res = await fetch("/api/admin/calendar/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blockForm),
    });

    const data = (await res.json()) as { message?: string };
    setMessage(data.message ?? "Block created.");
    await refreshAll();
  }

  async function removeBlock(id: string) {
    await fetch("/api/admin/calendar/blocks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await refreshAll();
  }

  function removeRoom(roomId: string) {
    const roomName = rooms.find((room) => room.id === roomId)?.name ?? roomId;
    if (bookings.some((booking) => booking.roomTypeId === roomId)) {
      setMessageTone("error");
      setMessage(`Cannot delete "${roomName}" because it has booking history.`);
      return;
    }
    if (blocks.some((block) => block.roomTypeId === roomId)) {
      setMessageTone("error");
      setMessage(`Cannot delete "${roomName}" because it has active blockouts.`);
      return;
    }
    if (eventTypes.some((eventType) => eventType.roomTypeId === roomId)) {
      setMessageTone("error");
      setMessage(`Cannot delete "${roomName}" because event types are attached to it. Reassign them first.`);
      return;
    }
    if (!window.confirm(`Delete room "${roomName}" and its pricing rows?`)) return;

    setRooms((current) => current.filter((room) => room.id !== roomId));
    setPricingRules((current) => current.filter((rule) => rule.roomTypeId !== roomId));
    setBlockForm((current) => ({
      ...current,
      roomTypeId: current.roomTypeId === roomId ? "" : current.roomTypeId,
    }));
    setMessageTone("success");
    setMessage(`Removed room "${roomName}". Click Save Configuration to persist.`);
  }

  function removeEventType(eventTypeId: string) {
    const eventTypeName = eventTypes.find((eventType) => eventType.id === eventTypeId)?.name ?? eventTypeId;
    if (bookings.some((booking) => booking.eventTypeId === eventTypeId)) {
      setMessageTone("error");
      setMessage(`Cannot delete "${eventTypeName}" because it has booking history.`);
      return;
    }
    if (!window.confirm(`Delete event type "${eventTypeName}" and related pricing rows?`)) return;

    setEventTypes((current) => current.filter((eventType) => eventType.id !== eventTypeId));
    setPricingRules((current) => current.filter((rule) => rule.eventTypeId !== eventTypeId));
    setMessageTone("success");
    setMessage(`Removed event type "${eventTypeName}". Click Save Configuration to persist.`);
  }

  function removePricingRule(ruleId: string) {
    if (!window.confirm("Delete this pricing row?")) return;
    setPricingRules((current) => current.filter((rule) => rule.id !== ruleId));
    setMessageTone("success");
    setMessage("Removed pricing row. Click Save Configuration to persist.");
  }

  const roomNameMap = useMemo(
    () => Object.fromEntries(rooms.map((item) => [item.id, item.name])),
    [rooms],
  );
  const eventNameMap = useMemo(
    () => Object.fromEntries(eventTypes.map((item) => [item.id, item.name])),
    [eventTypes],
  );

  return (
    <div className="admin-console">
      <p className="admin-note">No authentication layer is included yet. Add RBAC in production.</p>
      {message ? <p className={`form-message ${messageTone}`}>{message}</p> : null}

      <section className="admin-panel">
        <h2>Room Types and Working Hours</h2>
        <div className="admin-list">
          {rooms.map((room, index) => (
            <div className="admin-row admin-row-rooms" key={room.id}>
              <input
                placeholder="Room Name"
                value={room.name}
                onChange={(event) =>
                  setRooms((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
              <input
                type="time"
                step={3600}
                value={room.workingHours.startTime}
                onChange={(event) =>
                  setRooms((current) =>
                    current.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            workingHours: {
                              ...item.workingHours,
                              startTime: event.target.value,
                            },
                          }
                        : item,
                    ),
                  )
                }
              />
              <input
                type="time"
                step={3600}
                value={room.workingHours.endTime}
                onChange={(event) =>
                  setRooms((current) =>
                    current.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            workingHours: {
                              ...item.workingHours,
                              endTime: event.target.value,
                            },
                          }
                        : item,
                    ),
                  )
                }
              />
              <button
                className="btn btn-secondary"
                onClick={() => removeRoom(room.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
        <button
          className="btn btn-secondary"
          onClick={() =>
            setRooms((current) => [
              ...current,
              {
                id: uid("room"),
                name: "New Room",
                workingHours: { startTime: "07:00", endTime: "21:00" },
              },
            ])
          }
          type="button"
        >
          Add Room
        </button>
        <button className="btn btn-primary" onClick={saveConfig} type="button">
          Save Configuration
        </button>
      </section>

      <section className="admin-panel">
        <h2>Event Types (Duration + Priority)</h2>
        <div className="admin-list">
          {eventTypes.map((eventType, index) => (
            <div className="admin-row admin-row-event-types" key={eventType.id}>
              <input
                value={eventType.name}
                onChange={(event) =>
                  setEventTypes((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
              <select
                value={eventType.roomTypeId ?? ""}
                onChange={(event) =>
                  setEventTypes((current) =>
                    current.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            roomTypeId: event.target.value || undefined,
                          }
                        : item,
                    ),
                  )
                }
              >
                <option value="">All Rooms</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
              <input
                min={1}
                type="number"
                value={eventType.durationHours}
                onChange={(event) =>
                  setEventTypes((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, durationHours: Number(event.target.value) } : item,
                    ),
                  )
                }
              />
              <input
                min={1}
                type="number"
                value={eventType.priority}
                onChange={(event) =>
                  setEventTypes((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, priority: Number(event.target.value) } : item,
                    ),
                  )
                }
              />
              <button
                className="btn btn-secondary"
                onClick={() => removeEventType(eventType.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
        <button
          className="btn btn-secondary"
          onClick={() =>
            setEventTypes((current) => [
              ...current,
              { id: uid("event"), name: "New Type", durationHours: 4, priority: 1, roomTypeId: rooms[0]?.id },
            ])
          }
          type="button"
        >
          Add Event Type
        </button>
        <button className="btn btn-primary" onClick={saveConfig} type="button">
          Save Configuration
        </button>
      </section>

      <section className="admin-panel">
        <h2>Pricing Matrix</h2>
        <div className="admin-list">
          {pricingRules.map((rule, index) => (
            <div className="admin-row admin-row-pricing" key={rule.id}>
              <select
                value={rule.roomTypeId}
                onChange={(event) =>
                  setPricingRules((current) =>
                    current.map((item, i) => {
                      if (i !== index) return item;
                      const nextRoomTypeId = event.target.value;
                      const allowedEventTypeIds = eventTypes
                        .filter((eventType) => !eventType.roomTypeId || eventType.roomTypeId === nextRoomTypeId)
                        .map((eventType) => eventType.id);
                      return {
                        ...item,
                        roomTypeId: nextRoomTypeId,
                        eventTypeId: allowedEventTypeIds.includes(item.eventTypeId)
                          ? item.eventTypeId
                          : (allowedEventTypeIds[0] ?? ""),
                      };
                    }),
                  )
                }
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
              <select
                value={rule.eventTypeId}
                onChange={(event) =>
                  setPricingRules((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, eventTypeId: event.target.value } : item,
                    ),
                  )
                }
              >
                {eventTypes
                  .filter((eventType) => !eventType.roomTypeId || eventType.roomTypeId === rule.roomTypeId)
                  .map((eventType) => (
                  <option key={eventType.id} value={eventType.id}>
                    {eventType.name}
                  </option>
                  ))}
              </select>
              <select
                value={rule.acMode}
                onChange={(event) =>
                  setPricingRules((current) =>
                    current.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            acMode: event.target.value as "with_ac" | "without_ac",
                          }
                        : item,
                    ),
                  )
                }
              >
                <option value="with_ac">With AC</option>
                <option value="without_ac">Without AC</option>
              </select>
              <select
                value={rule.dayType}
                onChange={(event) =>
                  setPricingRules((current) =>
                    current.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            dayType: event.target.value as "weekday" | "weekend" | "any",
                          }
                        : item,
                    ),
                  )
                }
              >
                <option value="any">Any Day</option>
                <option value="weekday">Weekday</option>
                <option value="weekend">Weekend</option>
              </select>
              <input
                min={0}
                type="number"
                value={rule.amountLkr}
                onChange={(event) =>
                  setPricingRules((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, amountLkr: Number(event.target.value) } : item,
                    ),
                  )
                }
              />
              <button
                className="btn btn-secondary"
                onClick={() => removePricingRule(rule.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
        <button
          className="btn btn-secondary"
          onClick={() =>
            setPricingRules((current) => [
              ...current,
              {
                id: uid("price"),
                roomTypeId: rooms[0]?.id ?? "",
                eventTypeId: eventTypes[0]?.id ?? "",
                acMode: "without_ac",
                dayType: "any",
                amountLkr: 0,
              },
            ])
          }
          type="button"
        >
          Add Pricing Row
        </button>
        <button className="btn btn-primary" onClick={saveConfig} type="button">
          Save Configuration
        </button>
      </section>

      <section className="admin-panel">
        <h2>Calendar Blockouts</h2>
        <div className="admin-row">
          <select
            value={blockForm.roomTypeId}
            onChange={(event) =>
              setBlockForm((current) => ({ ...current, roomTypeId: event.target.value }))
            }
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={blockForm.date}
            onChange={(event) =>
              setBlockForm((current) => ({ ...current, date: event.target.value }))
            }
          />
          <input
            type="time"
            value={blockForm.startTime}
            onChange={(event) =>
              setBlockForm((current) => ({ ...current, startTime: event.target.value }))
            }
          />
          <input
            type="time"
            value={blockForm.endTime}
            onChange={(event) =>
              setBlockForm((current) => ({ ...current, endTime: event.target.value }))
            }
          />
          <input
            type="text"
            value={blockForm.reason}
            onChange={(event) =>
              setBlockForm((current) => ({ ...current, reason: event.target.value }))
            }
          />
          <button className="btn btn-primary" onClick={createBlock} type="button">
            Block Slot
          </button>
        </div>
        <ul className="selected-slot-list">
          {blocks.map((block) => (
            <li key={block.id}>
              {roomNameMap[block.roomTypeId]} {block.date} {block.startTime}-{block.endTime} ({block.reason})
              <button
                className="btn btn-secondary"
                onClick={() => void removeBlock(block.id)}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-panel">
        <h2>Booking Queue and Reconciliation</h2>
        <div className="admin-bookings">
          {bookings.map((booking) => (
            <article className="admin-booking-card" key={booking.id}>
              <h3>
                {booking.customer.name} - {roomNameMap[booking.roomTypeId]} / {eventNameMap[booking.eventTypeId]}
              </h3>
              <p>
                Status: <strong>{booking.status}</strong>
              </p>
              <p>Total: LKR {new Intl.NumberFormat("en-LK").format(booking.totalAmountLkr)}</p>
              <p>
                {booking.customer.email} | {booking.customer.phone}
              </p>
              <p>{booking.customer.purpose}</p>
              <ul className="selected-slot-list">
                {booking.slots.map((slot) => (
                  <li key={`${booking.id}-${slot.date}-${slot.startTime}`}>
                    {slot.date} {slot.startTime}-{slot.endTime}
                  </li>
                ))}
              </ul>

              <div className="admin-row">
                <button
                  className="btn btn-secondary"
                  onClick={() => void updateBookingStatus(booking.id, "confirmed")}
                  type="button"
                >
                  Approve
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => void updateBookingStatus(booking.id, "tentative")}
                  type="button"
                >
                  Tentative
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => void updateBookingStatus(booking.id, "rejected")}
                  type="button"
                >
                  Reject
                </button>
              </div>

              <div className="admin-row">
                <select
                  value={booking.reconciliationStatus}
                  onChange={(event) =>
                    void updateReconciliation(
                      booking.id,
                      event.target.value as Booking["reconciliationStatus"],
                      booking.reconciliationNotes,
                    )
                  }
                >
                  <option value="unpaid">Unpaid</option>
                  <option value="part_paid">Part Paid</option>
                  <option value="paid">Paid</option>
                  <option value="waived">Waived</option>
                </select>
                <input
                  placeholder="Reconciliation notes"
                  value={booking.reconciliationNotes}
                  onChange={(event) =>
                    setBookings((current) =>
                      current.map((item) =>
                        item.id === booking.id
                          ? { ...item, reconciliationNotes: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    void updateReconciliation(
                      booking.id,
                      booking.reconciliationStatus,
                      booking.reconciliationNotes,
                    )
                  }
                  type="button"
                >
                  Save Notes
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
