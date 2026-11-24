import React, { useState } from "react";
import { GraphContainer } from "./components/GraphContainer";
import { NeutreekoBoard } from "./components/board/NeutreekoBoard";
import { PyrgaBoard } from "./components/board/PyrgaBoard";
import { GameType } from "./types/MyNodeData";

const App: React.FC = () => {
  const [gameType, setGameType] = useState<GameType>("neutreeko");
  const BoardComponent = gameType === "neutreeko" ? NeutreekoBoard : PyrgaBoard;

  return (
    <div>
      <div style={{ padding: 10 }}>
        <label htmlFor="game-type">Game type: </label>
        <select
          id="game-type"
          value={gameType}
          onChange={(event) => setGameType(event.target.value as GameType)}
        >
          <option value="neutreeko">Neutreeko</option>
          <option value="pyrga">Pyrga</option>
        </select>
      </div>
      {/* Remounting gives each game its own graph state and ID counter, and
          cancels the previous game's in-flight load. */}
      <GraphContainer
        key={gameType}
        gameType={gameType}
        BoardComponent={BoardComponent}
      />
    </div>
  );
};

export default App;
