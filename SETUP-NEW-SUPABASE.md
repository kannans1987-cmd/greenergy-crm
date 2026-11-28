# Moving the CRM to a new Supabase project

The old Supabase project behind greenergy-crm.vercel.app no longer exists (its address stopped resolving in November 2026), so nobody can sign in until these steps are done. **Update (24 Nov 2026):** the original `greenergy-crm` project was only paused (free projects pause after a week without use) and has been restored, with its staff, projects and job cards. For that project, skip step 1 and instead run `supabase/UPGRADE_EXISTING_PROJECT.sql` in the SQL Editor (it adds quotations, the documents bucket, the workflow and the price list, keeps existing data, and is safe to run twice), then do step 1b. The Vercel keys stay the same.

## 1. Create the project (10 minutes)

1. Go to https://supabase.com/dashboard, then click **New project**. Name it `greenergy-crm` and choose the **Mumbai (ap-south-1)** region. Save the database password somewhere safe.
2. Open **SQL Editor**, then **New query**. Paste the whole of `supabase/SETUP_NEW_PROJECT.sql` and press **Run**. It should finish with "Success. No rows returned".
3. Open **Authentication**, then **Sign In / Providers**, and turn **off** "Allow new users to sign up". Staff join through the CRM's Register page and your approval, which sends them an invite.
4. In **Authentication**, then **URL Configuration**, set:
   - **Site URL** to `https://greenergy-crm.vercel.app`
   - **Redirect URLs** to `https://greenergy-crm.vercel.app/auth/callback` and `https://greenergy-crm.vercel.app/staff/reset-password`

## 1b. Load your supplier price list (private)

Quotations are priced from your supplier price list. The list holds your purchase prices and margin, so it is kept out of the code: the GitHub repository is public, and `supabase/pricing/` is git-ignored.

1. On your PC, run `node supabase/build-pricing-seed.mjs`. It reads `supabase/pricing/price-list-2026-11.json` (copied from your three PDF price lists) and `supabase/pricing/cost-model.json` (your margin, size bands, structure and installation rates).
2. Open the generated `supabase/pricing/pricing_seed.sql`, paste it into the Supabase **SQL Editor** and run it.
3. From then on, change prices on the CRM's **Price List** page. Every save is versioned. For a new supplier PDF, update the rates there; there is no need to repeat these steps.

**All prices in the price list exclude GST.** Quotations add the margin, then GST (8.9%) once on the final price.

**Letting someone else update prices:** in **User Management**, set that person's **Price list access**:
- **Supplier prices**: they can update panel, inverter, battery, cable, ACDB/DCDB and shed rates. They cannot change the margin, and they cannot see the profit on individual quotations.
- **Prices & margin**: they can also change profit %, GST % and the sizing rules.
- **None** removes the access immediately.

Only the CEO can give or remove this access, and every change on the Price List page records who made it.

## 2. Create your CEO login

1. Go to **Authentication**, then **Users**, then **Add user** and **Create new user**. Enter `kannan.s1987@gmail.com` and a strong password, and tick **Auto Confirm User**.
2. In **SQL Editor**, run:
   ```sql
   update profiles set role = 'admin', status = 'active', full_name = 'Kannan Selvam'
   where email = 'kannan.s1987@gmail.com';
   ```

## 3. Point the website at the new project

1. In Supabase, open **Project Settings**, then **API**. Copy the **Project URL**, the **anon public** key and the **service_role** key.
2. In Vercel, open the **greenergy-crm** project, then **Settings**, then **Environment Variables**. Replace the values of:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (keep this one secret; it is only used on the server)
   - `NEXT_PUBLIC_SITE_URL` = `https://greenergy-crm.vercel.app`
   - `ADMIN_EMAIL` = `kannan.s1987@gmail.com`
3. Put the same values in `.env.local` for running the CRM on your PC.
4. Deploy the new code: push it to GitHub (Vercel deploys automatically), or press **Redeploy** in Vercel after pushing.

## 4. Add your team

- Staff open `/staff/register`. You approve them in **User Management**, which sends each one an email invite.
- Roles:

| CRM role | In the workflow | Can |
|---|---|---|
| `admin` | **CEO** | Approve, reject or send back quotations; appoint administrative officers; everything else |
| `task_manager` | **Admin manager** | Follow up all quotations, reassign, record acceptance, create numbered job cards, update milestones and payments |
| `employee` | **Sales / field staff** | Create quotations (assigned to themselves), submit for approval, share after approval, follow up, mark hot/cold |
| `employee` appointed on a project | **Administrative officer** | Update the milestones of the projects the CEO appointed them to |

- **Quotations: edit & delete** (User Management): the CEO can give this to anyone. They see and edit every quotation and can delete wrong, test or duplicate ones. Only the CEO and these people can delete; a quotation with a numbered job card can never be deleted, and every deletion is kept in the audit log with its reason. For the restored project, run `supabase/quotation_access_v1.sql` once in the SQL Editor (it is also part of `UPGRADE_EXISTING_PROJECT.sql`).
- **Attendance (office GPS)**: staff choose "At the office" or "Project site". Office clock-in only works when the phone's GPS is inside the office radius (checked in the database). The CEO sets the office in Attendance → Office location (press "Set office location here" while at the office, or paste Google Maps coordinates) and can change the radius. Managers see everyone's day in Attendance → Team attendance. For the restored project, run `supabase/attendance_v1.sql` once in the SQL Editor (also part of `UPGRADE_EXISTING_PROJECT.sql`).
- **Attendance phones**: each staff member presses "Register this phone" on the Attendance page of their own phone; the CEO approves it in Attendance → Attendance phones. Clock-in / clock-out then work only from that phone and only from a mobile browser (checked in the database; staff can no longer write attendance directly). Approving a new phone retires the old one. The CEO does not clock in or out (Attendance shows the CEO the team view, phone approvals and office location). Run `supabase/attendance_devices_v1.sql` once (also part of `UPGRADE_EXISTING_PROJECT.sql`).
- **Work allocation on quotations**: on each quotation the CEO or admin manager chooses (Work allocation → Save & notify) who does the site visit & customer meeting, who prepares the quotation and who follows up with the customer: any staff member, or the same person for several jobs. Each gets a notification and sees the job in Quotations → My work. The site-visit person records the visit (notes, roof / bill details, GPS); the follow-up person shares, logs calls, marks hot / cold, accepted or lost; only the preparer (or CEO / admin manager) changes prices; only the CEO approves. Run `supabase/quotation_allocation_v1.sql` once (also part of `UPGRADE_EXISTING_PROJECT.sql`).
- **Hot / cold leads**: can be set at any stage, from the first enquiry, by the CEO, the admin manager or any of the people working on the quotation, on the quotation page or straight from the Quotations list. A short reason and the next follow-up date (hot: tomorrow, cold: in a week) are saved; "Follow-ups due" lists every open lead due today or earlier, hot ones first. Run `supabase/lead_temperature_v1.sql` once (also part of `UPGRADE_EXISTING_PROJECT.sql`).
- **Phone / walk-in enquiries**: Quotations → "Log phone enquiry" (CEO, admin manager, or staff with "Quotations: edit & delete"). A short form (name, mobile, town, what they want, how they came, hot / cold, call-back date, optional work allocation and visit date). Saving numbers it like a website enquiry (GSS-QT-year-n) and it appears in the list; a warning shows if the mobile number is already in the CRM. No database change needed.
- **Job cards for ongoing projects**: projects started before the CRM (or without a quotation) get a numbered job card from the project page ("This project has no numbered job card yet") or Projects → "Add ongoing project" (CEO / admin manager). You choose where the work is now: earlier milestones are marked done, that one in progress. Order value and amount already received become an opening balance (received + balance due). An old / paper job card number can be kept. Run `supabase/job_card_ongoing_v1.sql` once (also part of `UPGRADE_EXISTING_PROJECT.sql`).
- **Deleting a project**: the CEO can delete a project that has no numbered job card and no quotation (open it → "Delete project"). The box shows what goes with it (team, field job cards and their entries, milestones, payments, documents) and what is kept (tasks, attendance, unlinked). A reason is required and a snapshot is kept in the audit log. Projects with a job card can never be deleted. Run `supabase/project_delete_v1.sql` once (also part of `UPGRADE_EXISTING_PROJECT.sql`).
- **Deleting a task**: the CEO can delete any task (Tasks → open the task → "Delete task"). Nobody else can. A copy is kept in the audit log, and if the task was still open the person it was given to gets a notification. Run `supabase/task_delete_v1.sql` once (also part of `UPGRADE_EXISTING_PROJECT.sql`).
- **Several clock-ins a day (site / O&M staff)**: each person has an attendance type, set by the CEO in Attendance → Team attendance. "Office" staff clock in once a day. "Site / O&M" staff clock in and out at every site they visit (session 1, 2, 3 …); a new session can start only after the last one is clocked out. Day totals and the monthly report add the sessions up; overtime counts on the day total over 8 h. A session left open for more than 18 hours must be corrected by the CEO and does not block the next clock-in. Run `supabase/attendance_multi_v1.sql` once (also part of `UPGRADE_EXISTING_PROJECT.sql`).
- **Growth (growth_v1.sql)**: Control room (what is stuck today), Sales insights (funnel, lost-reason Pareto, speed to lead, sources, team hours), required lost-reason codes, first-call alert when a website lead is not called within the hour, auto-approval inside the CEO's rules (Business rules; starts OFF), payment due dates that follow the milestones with part payments and receipts, Money & subsidy tracker, referral codes and neighbour group links with rewards, and the commissioning checklist (photos, test values, customer signature) that must be complete before "Commissioning certificate issued" can be ticked, plus a customer report link (/r/…). Alerts run every 15 minutes if pg_cron is enabled (Database → Extensions → pg_cron), and whenever a manager opens the dashboard or Control room.
- **Service (service_v1.sql)**: service jobs (GSS/SR/…), yearly maintenance contracts (GSS/AMC/…) that book their own visits and remind 30 days before renewal, service invoices (GSS/SI/…, one gap-free series; CGST+SGST in Puducherry, IGST otherwise; confirm the SAC code with your CA), and O&M clock-ins on a service job so hours per job are known.
- **Out on work (attendance_outside_v1.sql)**: a fourth clock-in choice for site visits to leads, EB office / net-meter follow-ups, supplier purchases, bank / government offices and other errands. The person picks the purpose and can name the lead or project; a short note (where / what) is required when neither is named. GPS is recorded at clock-in and clock-out but there is no office radius. People who move between the office and outside work in one day need the attendance type "Field · several a day".
- **Quotations: view all, changes need the CEO (quotation_view_v1.sql)**: in User Management → Quotations, tick "View all · changes need you". That person sees every quotation (not supplier cost or margin) and can log phone / walk-in enquiries. On quotations they are not working on, "Request a change" sends new customer / site details and / or a written request to the CEO, who approves (applied at once, noted on the quotation) or rejects with a reason. Pending requests show in the Control room. On first run, active Admin Executives and the Project Manager get this access.
- **Panels, inverter and price chosen by hand (quotation_panels_v1.sql)**: under "Panels & inverter" pick DCR only, Non-DCR only or Mixed, and for each type the brand, panel size and the number of panels (the numbers decide the size; empty = worked out from the kW). Pick the inverter phase, a model from the price list (or automatic) and how many. Then "Re-price". The price can be typed as ₹/kW before GST, ₹/kW including GST, or the total payable including GST: the two "including GST" ways are kept exactly as typed (before-GST amount and GST worked backwards). For mixed systems the subsidy is on the DCR panels only.
- **Sr / Jr Admin Manager (allocation_levels_v1.sql)**: User Management → "Allocates work". A Sr Admin Manager allocates work to anyone in the organisation; a Jr Admin Manager to anyone except a Sr Admin Manager. Allocating work = giving tasks, choosing the site-visit / quotation / follow-up people on a quotation and planning the visit, and giving service jobs to technicians. They see every task, quotation and service job, but not supplier cost or margin, and changes to a quotation itself still go to the CEO as a change request. The person a task is given to can only update its progress, and is notified when it is given.
- **Kanban (kanban_v1.sql)**: Tasks → Board: To do → Doing → Review → Done, drag cards (arrows on a phone), one row per person. Each person may have N tasks in Doing (Business rules → Task board; default 3, 0 = no limit; the CEO and admin manager can go over it). Flag a card blocked with a reason; the giver is told, and is told when a card reaches Review. The board shows tasks in Doing, blocked, done in 7 days, typical time to finish and the oldest card in Doing; cards turn amber after N days in a column. Quotations → Pipeline board shows every open quotation by stage with the value waiting and highlights the bottleneck stage.
- **Leave policy (leave_policy_v1.sql)**: casual leave applied 5+ days ahead: 1 day paid, up to 2 if the reason is accepted as genuine, loss of pay from the 3rd day; abrupt casual leave and absence without intimation: all loss of pay; sick leave paid only with a medical certificate (private upload); more than 10 days away without a proper explanation: termination review (written explanation, then show-cause notice; the CRM never terminates by itself). Approval: Sr Admin Manager, then CEO. Leave → Absences lists working days with no clock-in and no leave; Leave → Month summary gives paid / loss-of-pay days for payroll. Numbers in Business rules → Leave policy. Also fixes the Leave page, which wrote columns the table did not have.
- **Attendance view (attendance_view_v1.sql)**: the Sr / Jr Admin Manager see Team attendance (everyone's clock-in, clock-out, place and hours) on the Attendance page, view only. Correcting a time, the attendance type and attendance phones stay with the CEO.
- **Staff photos (staff_photos_v1.sql)**: a photo for each person (My Profile → tap the camera; the CEO can set anyone's in User Management). Shown on the dashboard, header, sidebar, User Management and Team attendance; the dashboard of the CEO / admin manager / Sr / Jr Admin Manager shows "Team today" with everyone's photo and status. Photos are cropped square and shrunk to about 100 KB in the browser before upload.
- **Super Admin (super_admin_v1.sql)**: User Management → Role → Super Admin (CEO only). Everything the CEO can do, except: cannot change, deactivate or delete the CEO or another Super Admin, cannot make anyone CEO or Super Admin, cannot change their own role or status. Every change they make (on any table, and every server action in the audit log) is recorded with before / after in Super Admin activity (CEO only, cannot be edited or deleted) and the CEO gets a notification (grouped per 30 minutes). Stored as role admin + profiles.super_admin.
- **Project Manager (project_manager_v1.sql)**: User Management → Role → Project Manager. Allocates work (tasks, site visits, service jobs) to Solar Technicians and Helpers (anyone whose designation contains "technician" or "helper"), Jr Admin Managers and themselves; never to a Sr Admin Manager or other staff. The CEO can now edit any designation in User Management (click it).
- **Office hours and late marks (attendance_late_v1.sql)**: Business rules → Office hours (default 9:40 AM – 6:00 PM, 40 min grace). The first clock-in of the day after start + grace is marked late (minutes after the start time); the person and the CEO are told; the weekly off is never late. The CEO can excuse a late mark with a reason on the Attendance page. Team attendance shows late, left early and late days this month.
- Prices come from the **Price List** page (supplier rates, all excluding GST; see step 1b). New quotations are priced from it automatically.

## 5. How the flow works

Quotation (draft) → **Submit for CEO approval** → CEO **Approves**. Prices are then locked; **Revise** sends the quotation back for approval and the old customer link stops working.
→ **Share with customer & admin manager**. This creates the portal link and WhatsApp/email buttons, and the admin manager gets a notification.
→ Follow-ups are logged with a next date, and the quotation is marked **Hot** or **Cold**.
→ The customer presses **Accept** on the portal, or staff record the acceptance.
→ For a **Hot and accepted** quotation, **Create numbered job card** creates `GSS/JC/2026-27/0001`, the project, 23 milestones from order to end of life, and the 50/40/10 payment schedule.
→ The CEO appoints the **administrative officer**, who tracks the milestones.

These rules are enforced inside the database (`supabase/workflow_v2.sql`), not only on screen.

## Checking the database rules

`supabase/tests/workflow_v2_test.sql` signs in as each role and checks every rule. Run it only on a throwaway database, never on the live project; see `supabase/tests/README.md`.
