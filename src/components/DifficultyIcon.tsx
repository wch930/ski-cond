import type { Difficulty } from '../types';

interface Props {
  difficulty: Difficulty;
}

export function DifficultyIcon({ difficulty }: Props) {
  if (difficulty === 'green') {
    return (
      <span className="diff-icon" title="Beginner · 绿道">
        <span className="diff-circle" />
      </span>
    );
  }
  if (difficulty === 'blue') {
    return (
      <span className="diff-icon" title="Intermediate · 蓝道">
        <span className="diff-square" />
      </span>
    );
  }
  if (difficulty === 'double-black') {
    return (
      <span className="diff-icon" title="Expert · 双黑钻">
        <span className="diff-double">
          <span />
          <span />
        </span>
      </span>
    );
  }
  return (
    <span className="diff-icon" title="Advanced · 黑钻">
      <span className="diff-diamond" />
    </span>
  );
}
