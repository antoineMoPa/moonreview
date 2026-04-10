type FooterProps = {
  exportText: string;
};

export function Footer({ exportText }: FooterProps) {
  return (
    <section className="panel panel-plain">
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <h2>Review</h2>
      </div>
      <textarea className="review-summary-output" readOnly spellCheck={false} value={exportText} />
    </section>
  );
}
