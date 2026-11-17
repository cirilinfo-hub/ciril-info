// Bridge to the existing site bundle. window.__CXD is set by the patched bundle
// right before this module runs; it exposes the site's own React instance,
// router helpers and page-level components so new pages reuse them verbatim.
const D = window.__CXD;
export const React = D.React;
export const h = React.createElement;
export const Fragment = React.Fragment;
export const { useState, useEffect, useMemo, useRef, useId, useCallback, useContext, createContext } = React;
export const Link = D.Link;
export const NavLink = D.NavLink;
export const useLocation = D.useLocation;
export const useNavigate = D.useNavigate;
export const Outlet = D.Outlet;
export const Seo = D.Seo;
export const PageHero = D.PageHero;
export const SectionHead = D.SectionHead;
export const Reveal = D.Reveal;
export const Faq = D.Faq;
export const CtaBand = D.CtaBand;
export const ButtonLink = D.ButtonLink;
export const Crumbs = D.Crumbs;
export const Brand = D.Brand;
export const ScrollTop = D.ScrollTop;
export const C = window.Cirilinfo;
export const cx = (...a) => a.filter(Boolean).join(" ");
