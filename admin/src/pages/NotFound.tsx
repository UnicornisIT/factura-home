import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100 px-4">
      <div className="text-center space-y-3">
        <div className="text-5xl font-bold text-[#7a3a3a]">404</div>
        <p className="text-slate-300">Страница не найдена</p>
        <Link
          to="/"
          className="inline-block mt-3 px-4 py-2 rounded-md bg-[#5C2A2A] text-white text-sm hover:bg-[#7a3a3a] transition-colors"
        >
          ← На дэшборд
        </Link>
      </div>
    </div>
  );
}
