const activityItems = [
  "Boxing",
  "Fencing",
  "Gymnastic",
  "Karate",
  "Wushu",
  "Wrestling",
  "Any type of grappling sports",
  "Seminars",
  "Meetings",
  "Performing Arts",
];

export default function ActivitiesPage() {
  return (
    <section className="page-section container content-page">
      <h1>Activities</h1>
      <p>Facilities at Royal MAS Arena can house following activities...</p>
      <ul className="bullet-list">
        {activityItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
