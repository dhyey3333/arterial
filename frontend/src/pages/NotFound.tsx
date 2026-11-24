import { Link } from 'react-router';
import { Panel } from '../components/ui/primitives';

export default function NotFound() {
  return (
    <div className="stack">
      <Panel title="No page here" enter={0}>
        <p className="soft">This address is not part of Arterial.</p>
        <p>
          <Link to="/" className="link-arrow">
            Go to the command center
          </Link>
        </p>
      </Panel>
    </div>
  );
}
