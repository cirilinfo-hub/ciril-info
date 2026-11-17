import type * as React from 'react';
type Btn = React.ButtonHTMLAttributes<HTMLButtonElement>;
type Inp = React.InputHTMLAttributes<HTMLInputElement>;
export type IconName = 'arrow-right' | 'chevron-right' | 'chevron-left' | 'chevron-down' | 'plus' | 'close' | 'check' | 'check-circle' | 'info' | 'warning' | 'error' | 'mail' | 'search' | 'grid' | 'tasks' | 'folder' | 'calendar' | 'team' | 'settings' | 'database' | 'sliders' | 'menu' | 'user' | 'clock';
export interface IconProps { name: IconName; size?: 'sm' | 'md'; title?: string; className?: string }
export interface ButtonProps extends Btn { variant?: 'accent' | 'primary' | 'secondary' | 'tertiary'; size?: 'sm' | 'md' | 'lg'; leadingIcon?: IconName; trailingIcon?: IconName | null; block?: boolean }
export interface TextFieldProps extends Inp { label?: string; hint?: string; error?: string; icon?: IconName }
export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { label?: string; hint?: string; error?: string; maxLength?: number }
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> { label?: string; hint?: string; error?: string; options: (string | { value: string; label: string; disabled?: boolean })[] }
export interface EmailCaptureProps extends Inp { buttonLabel?: string; label?: string; onSubmit?: (e: React.FormEvent) => void }
export interface CheckboxProps extends Inp { label: React.ReactNode; strikeWhenChecked?: boolean }
export interface RadioProps extends Inp { label: React.ReactNode }
export interface SwitchProps extends Inp { label: React.ReactNode }
export interface TabsProps { items: { value: string; label: string; count?: number; content?: React.ReactNode }[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; label?: string }
export interface SegmentedControlProps { options: string[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; label?: string }
export interface BadgeProps { tone?: 'brand' | 'neutral' | 'success' | 'warning' | 'error' | 'info'; dot?: boolean; children?: React.ReactNode }
export interface TagProps { tone?: 'orchid' | 'violet'; children?: React.ReactNode }
export interface RatingChipProps { value: string | number; label?: string }
export interface TooltipProps { content: React.ReactNode; light?: boolean; open?: boolean; children: React.ReactElement }
export interface AvatarProps { size?: 24 | 32 | 40 | 56; initials?: string; src?: string; name?: string; status?: boolean }
export interface AvatarStackProps { people: { initials?: string; src?: string; name?: string }[]; more?: string; size?: 24 | 32 | 40 | 56 }
export interface NavLink { label: string; href?: string; current?: boolean }
export interface Brand { name?: string; highlight?: string; href?: string }
export interface NavBarProps { left?: NavLink[]; right?: NavLink[]; brand?: Brand; account?: boolean; sticky?: boolean }
export interface SidebarProps { sections: { label?: string; items: { label: string; icon?: IconName; href?: string; current?: boolean; count?: number }[] }[]; promo?: { title: string; text: string; action?: string }; brand?: Brand }
export interface BreadcrumbsProps { items: { label: string; href?: string }[] }
export interface PaginationProps { total: number; page?: number; defaultPage?: number; onChange?: (p: number) => void }
export interface FeatureCardProps { icon?: IconName; title: string; onBrand?: boolean; children?: React.ReactNode }
export interface ProjectCardProps { title: string; status?: string; date?: string; progress?: number; children?: React.ReactNode }
export interface StatBlockProps { stats: { value: string; label: string }[] }
export interface TestimonialProps { quote: string; name: string; role?: string }
export interface BlogCardProps { image?: string; tag?: string; readTime?: string; title: string; date?: string }
export interface CTABandProps { title: string; action?: string; onAction?: () => void; shape?: boolean; children?: React.ReactNode }
export interface TaskListProps { title?: string; tasks: { label: string; done?: boolean }[]; onAdd?: () => void }
export interface ModalProps { title: string; subtitle?: string; icon?: IconName; size?: 'sm' | 'md' | 'lg'; footer?: React.ReactNode; open?: boolean; onClose?: () => void; inline?: boolean; children?: React.ReactNode }
export interface AlertProps { tone?: 'success' | 'info' | 'warning' | 'error'; title: string; children?: React.ReactNode }
export interface ToastProps { avatar?: string; time?: string; action?: string; onAction?: () => void; children?: React.ReactNode }
export interface TableProps<R = Record<string, unknown>> { columns: { key: string; label: string; align?: 'left' | 'right' | 'center'; render?: (row: R) => React.ReactNode }[]; rows: R[] }
export declare function Icon(p: IconProps): React.ReactElement;
export declare function Button(p: ButtonProps): React.ReactElement;
export declare function TextField(p: TextFieldProps): React.ReactElement;
export declare function TextArea(p: TextAreaProps): React.ReactElement;
export declare function Select(p: SelectProps): React.ReactElement;
export declare function EmailCapture(p: EmailCaptureProps): React.ReactElement;
export declare function Checkbox(p: CheckboxProps): React.ReactElement;
export declare function Radio(p: RadioProps): React.ReactElement;
export declare function Switch(p: SwitchProps): React.ReactElement;
export declare function Tabs(p: TabsProps): React.ReactElement;
export declare function SegmentedControl(p: SegmentedControlProps): React.ReactElement;
export declare function Badge(p: BadgeProps): React.ReactElement;
export declare function Tag(p: TagProps): React.ReactElement;
export declare function RatingChip(p: RatingChipProps): React.ReactElement;
export declare function Tooltip(p: TooltipProps): React.ReactElement;
export declare function Avatar(p: AvatarProps): React.ReactElement;
export declare function AvatarStack(p: AvatarStackProps): React.ReactElement;
export declare function NavBar(p: NavBarProps): React.ReactElement;
export declare function Sidebar(p: SidebarProps): React.ReactElement;
export declare function Breadcrumbs(p: BreadcrumbsProps): React.ReactElement;
export declare function Pagination(p: PaginationProps): React.ReactElement;
export declare function FeatureCard(p: FeatureCardProps): React.ReactElement;
export declare function ProjectCard(p: ProjectCardProps): React.ReactElement;
export declare function StatBlock(p: StatBlockProps): React.ReactElement;
export declare function Testimonial(p: TestimonialProps): React.ReactElement;
export declare function BlogCard(p: BlogCardProps): React.ReactElement;
export declare function CTABand(p: CTABandProps): React.ReactElement;
export declare function TaskList(p: TaskListProps): React.ReactElement;
export declare function Modal(p: ModalProps): React.ReactElement | null;
export declare function Alert(p: AlertProps): React.ReactElement;
export declare function Toast(p: ToastProps): React.ReactElement;
export declare function Table<R>(p: TableProps<R>): React.ReactElement;
declare global { interface Window { Cirilinfo: { Icon: typeof Icon; Button: typeof Button; TextField: typeof TextField; TextArea: typeof TextArea; Select: typeof Select; EmailCapture: typeof EmailCapture; Checkbox: typeof Checkbox; Radio: typeof Radio; Switch: typeof Switch; Tabs: typeof Tabs; SegmentedControl: typeof SegmentedControl; Badge: typeof Badge; Tag: typeof Tag; RatingChip: typeof RatingChip; Tooltip: typeof Tooltip; Avatar: typeof Avatar; AvatarStack: typeof AvatarStack; NavBar: typeof NavBar; Sidebar: typeof Sidebar; Breadcrumbs: typeof Breadcrumbs; Pagination: typeof Pagination; FeatureCard: typeof FeatureCard; ProjectCard: typeof ProjectCard; StatBlock: typeof StatBlock; Testimonial: typeof Testimonial; BlogCard: typeof BlogCard; CTABand: typeof CTABand; TaskList: typeof TaskList; Modal: typeof Modal; Alert: typeof Alert; Toast: typeof Toast; Table: typeof Table } } }
