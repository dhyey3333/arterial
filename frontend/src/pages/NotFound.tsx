import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { PageHead } from '../components/ui/primitives';

export default function NotFound() {
  return (
    <div>
      <PageHead title="No page here" lede="This address is not part of Arterial" />
      <div className="page">
        <Link to="/console" className="link">
          Go to the command center <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
