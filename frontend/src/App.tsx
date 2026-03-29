import React, { useState } from "react";
import { GraphContainer } from "./components/GraphContainer";
import { NeutreekoBoard } from "./components/board/NeutreekoBoard";
import { PyrgaBoard } from "./components/board/PyrgaBoard";

const App: React.FC = () => {
  const [gameType, setGameType] = useState<"neutreeko" | "pyrga">("neutreeko");

  const BoardComponent = gameType === "neutreeko" ? NeutreekoBoard : PyrgaBoard;

  return (
    <div>
      <div style={{ padding: 10 }}>
        <label>Game Type: </label>
        <select
          value={gameType}
          onChange={(e) => setGameType(e.target.value as "neutreeko" | "pyrga")}
        >
          <option value="neutreeko">Neutreeko</option>
          <option value="pyrga">Pyrga</option>
        </select>
      </div>
      <GraphContainer gameType={gameType} BoardComponent={BoardComponent} />
    </div>
  );
};

export default App; // ← default export に変更
