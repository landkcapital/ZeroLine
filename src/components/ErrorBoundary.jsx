import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <h2>Something went wrong</h2>
          <p style={{ color: "#888", margin: "1rem 0" }}>
            An unexpected error occurred.
          </p>
          <button
            className="btn primary"
            onClick={() => {
              this.setState({ hasError: false });
              window.location.reload();
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
