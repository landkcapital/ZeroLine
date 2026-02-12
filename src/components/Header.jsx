import { useNavigate, useLocation } from "react-router-dom";
import { signOut } from "../lib/auth";

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <>
      <header className="header">
        <div className="header-left">
          <h1 className="logo" onClick={() => navigate("/")}>
            ZeroLine
          </h1>
        </div>
        <nav className="header-nav desktop-nav">
          <button
            className={`nav-btn ${location.pathname === "/" ? "active" : ""}`}
            onClick={() => navigate("/")}
          >
            Home
          </button>
          <button
            className={`nav-btn ${location.pathname === "/budgets" ? "active" : ""}`}
            onClick={() => navigate("/budgets")}
          >
            Budgets
          </button>
          <button
            className={`nav-btn ${location.pathname === "/history" ? "active" : ""}`}
            onClick={() => navigate("/history")}
          >
            History
          </button>
          <button className="nav-btn sign-out" onClick={handleSignOut}>
            Sign Out
          </button>
        </nav>
        <div className="header-right-mobile">
          <button className="nav-btn sign-out" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      <nav className="bottom-nav">
        <button
          className={`bottom-nav-btn ${location.pathname === "/" ? "active" : ""}`}
          onClick={() => navigate("/")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>Home</span>
        </button>
        <button
          className={`bottom-nav-btn ${location.pathname === "/budgets" ? "active" : ""}`}
          onClick={() => navigate("/budgets")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          <span>Budgets</span>
        </button>
        <button
          className={`bottom-nav-btn ${location.pathname === "/history" ? "active" : ""}`}
          onClick={() => navigate("/history")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>History</span>
        </button>
      </nav>
    </>
  );
}
