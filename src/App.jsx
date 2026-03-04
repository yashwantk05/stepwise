import { Excalidraw } from "@excalidraw/excalidraw";

function App() {
  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <h1>My Excalidraw Whiteboard</h1>
      <div style={{ height: "90%" }}>
        <Excalidraw />
      </div>
    </div>
  );
}

export default App;