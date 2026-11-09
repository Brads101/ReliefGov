import { Link } from 'react-router-dom';
import Button from '../components/ui/Button.jsx';
import { LogoMark } from '../components/ui/Logo.jsx';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">
      <LogoMark className="h-12 w-12" />
      <h1 className="text-xl font-semibold text-navy-900">Page not found</h1>
      <p className="max-w-md text-[13.5px] text-slate-500">
        The page you requested does not exist in ReliefGov.
      </p>
      <Link to="/dashboard">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  );
}
