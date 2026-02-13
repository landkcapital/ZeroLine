import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getSession, onAuthStateChange } from "./lib/auth";
import Header from "./components/Header";
import ErrorBoundary from "./components/ErrorBoundary";
import Loading from "./components/Loading";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Budgets from "./pages/Budgets";
import BudgetDetail from "./pages/BudgetDetail";
import History from "./pages/History";
import "./styles.css";

function ProtectedRoute({ session, ready, children }) {
  if (!ready) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  return (
    <>
      <Header />
      <main>{children}</main>
    </>
  );
}

function PublicRoute({ session, ready, children }) {
  if (!ready) return <Loading />;
  if (session) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let ignore = false;

    getSession().then((s) => {
      if (!ignore) {
        setSession(s);
        setReady(true);
      }
    });

    const subscription = onAuthStateChange((s) => {
      if (!ignore) {
        setSession(s);
        setReady(true);
      }
    });

    return () => {
      ignore = true;
      subscription?.unsubscribe();
    };
  }, []);

  return (
    <BrowserRouter>
      <ErrorBoundary>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicRoute session={session} ready={ready}>
              <Login onAuth={setSession} />
            </PublicRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute session={session} ready={ready}>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/budgets"
          element={
            <ProtectedRoute session={session} ready={ready}>
              <Budgets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/budget/:id"
          element={
            <ProtectedRoute session={session} ready={ready}>
              <BudgetDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute session={session} ready={ready}>
              <History />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
