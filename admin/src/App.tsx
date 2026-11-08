import { Routes, Route } from "react-router";
import Dashboard from "@/pages/Dashboard";
import Products from "@/pages/Products";
import Collections from "@/pages/Collections";
import Orders from "@/pages/Orders";
import Content from "@/pages/Content";
import Access from "@/pages/Access";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <Routes>
      {/* Логин — отдельная страница без сайдбара */}
      <Route path="/login" element={<Login />} />

      {/* Все защищённые страницы — каждая использует AdminLayout,
          который редиректит на /login если не админ. */}
      <Route path="/" element={<Dashboard />} />
      <Route path="/products" element={<Products />} />
      <Route path="/collections" element={<Collections />} />
      <Route path="/orders" element={<Orders />} />
      <Route path="/content" element={<Content />} />
      <Route path="/access" element={<Access />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
