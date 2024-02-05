'strict';

// Include cds libraries and utility files
const cds = require('@sap/cds');
const codes = require('./util/codes');
const uniqueNumberGenerator = require('./util/uniqueNumberGenerator');

module.exports = cds.service.impl(async (srv) => {
  const db = await cds.connect.to('db');
  // ----------------------------------------------------------------------------
  // Implementation of entity events (entity PoetrySlams)

  // Initialize status
  // Default the freeVisitorSeats to the maximumVisitorsNumber
  // Default number of PoetrySlam (human readable identifier)
  srv.before('CREATE', ['PoetrySlams.drafts', 'PoetrySlams'], async (req) => {
    if (!req.data.maxVisitorsNumber) {
      req.data.maxVisitorsNumber = 0;
    }
    req.data.freeVisitorSeats = req.data.maxVisitorsNumber;
    req.data.bookedSeats =
      req.data.maxVisitorsNumber - req.data.freeVisitorSeats;

    // Drafts get number with the first activation
    if (!req.target.name.endsWith('drafts')) {
      // Generate readable ID for Poetry Slam document
      try {
        req.data.number =
          'PS-' +
          (await uniqueNumberGenerator.getNextNumber(
            'poetrySlamNumber',
            db.kind,
            req.data.ID
          ));
      } catch (error) {
        req.error(500, 'NO_POETRYSLAM_NUMBER', [error.message]);
      }
    }
  });

  // Set the event status to booked based on confirmed seats
  srv.on('UPDATE', ['PoetrySlams.drafts', 'PoetrySlams'], async (req, next) => {
    const { ID } = req.data;
    const result = await calculatePoetrySlamData(ID, req, null);
    if (result) {
      req.data.freeVisitorSeats = result.freeVisitorSeats;
      req.data.status_code = result.status_code;
    }
    // Handle the next entry
    return next();
  });

  srv.before('DELETE', 'PoetrySlams', async (req) => {
    // In req.subject, the poetry slam that is to be deleted is already included as condition
    const poetrySlam = await SELECT.one
      .from(req.subject)
      .columns('status_code', 'number');

    if (
      poetrySlam.status_code !== codes.poetrySlamStatusCode.inPreparation &&
      poetrySlam.status_code !== codes.poetrySlamStatusCode.canceled
    ) {
      req.error(400, 'POETRYSLAM_COULD_NOT_BE_DELETED', [poetrySlam.number]);
    }
  });

  // Apply a colour code based on the poetry slam status
  srv.after('READ', ['PoetrySlams.drafts', 'PoetrySlams'], (data) => {
    const asArray = (x) => (Array.isArray(x) ? x : [x]);
    for (const poetrySlam of asArray(data)) {
      const status = poetrySlam.status?.code || poetrySlam.status_code;
      // Set status colour code
      switch (status) {
        case codes.poetrySlamStatusCode.inPreparation:
          poetrySlam.statusCriticality = codes.color.grey; // New poetry slams are grey
          break;
        case codes.poetrySlamStatusCode.published:
          poetrySlam.statusCriticality = codes.color.green; // Published poetry slams are green
          break;
        case codes.poetrySlamStatusCode.booked:
          poetrySlam.statusCriticality = codes.color.yellow; // Fully booked poetry slams are yellow
          break;
        case codes.poetrySlamStatusCode.canceled:
          poetrySlam.statusCriticality = codes.color.red; // Canceled poetry slams are red
          break;
        default:
          poetrySlam.statusCriticality = null;
      }
    }
  });

  // ----------------------------------------------------------------------------
  // Implementation of entity actions (entity PoetrySlams)

  // Entity action "cancel": Set the status of poetry slam to canceled
  // Note: Our entity action "cancel" is different from the core service "CANCEL"
  // Actions are not mass enabled in service, only on UI; they are handled in a batch mode;
  srv.on('cancel', async (req) => {
    const id = req.params[req.params.length - 1].ID;
    // Allow action for active entity instances only (draft events cannot be canceled)
    const poetrySlam = await SELECT.one
      .from('PoetrySlamManager.PoetrySlams')
      .columns('ID', 'status_code', 'number')
      .where({ ID: id });

    // If poetry slam was not found, throw an error
    if (!poetrySlam) {
      req.error(400, 'POETRYSLAM_NOT_FOUND', [id]);
      return;
    } else if (
      poetrySlam.status_code === codes.poetrySlamStatusCode.inPreparation
    ) {
      // Poetry slams that are in preperation shall be deleted
      req.info(200, 'ACTION_CANCEL_IN_PREPARATION', [poetrySlam.number]);
      return poetrySlam;
    }

    poetrySlam.status_code = codes.poetrySlamStatusCode.canceled;

    // Update cancellation status of the reading event
    const result = await UPDATE('PoetrySlamManager.PoetrySlams')
      .set({ status_code: poetrySlam.status_code })
      .where({ ID: id });

    // Handle error update result
    if (result !== 1) {
      // Success
      // Error message: could not be canceled
      req.error(500, 'ACTION_CANCEL_NOT_POSSIBLE', [poetrySlam.number]);
      return;
    }

    req.info(200, 'ACTION_CANCEL_SUCCESS', [poetrySlam.number]);
    return poetrySlam; // Return the changed poetry slam
  });

  // Entity action "publish": Set the status of poetry slam to published
  // Actions are not mass enabled in service, only on UI; they are handled in a batch mode;
  srv.on('publish', async (req) => {
    const id = req.params[req.params.length - 1].ID;
    // Allow action for active entity instances only (draft events cannot be published)
    const poetrySlam = await SELECT.one
      .from('PoetrySlamManager.PoetrySlams')
      .columns('ID', 'status_code', 'number')
      .where({ ID: id });

    // If poetry slam was not found, throw an error
    if (!poetrySlam) {
      req.error(400, 'POETRYSLAM_NOT_FOUND', [id]);
      return;
    }

    if (
      poetrySlam.status_code === codes.poetrySlamStatusCode.booked ||
      poetrySlam.status_code === codes.poetrySlamStatusCode.published
    ) {
      req.info(200, 'ACTION_PUBLISHED_ALREADY', [poetrySlam.number]);
      return poetrySlam;
    }

    const data = await calculatePoetrySlamData(id, req);
    poetrySlam.status_code =
      data.freeVisitorSeats > 0
        ? codes.poetrySlamStatusCode.published
        : codes.poetrySlamStatusCode.booked;

    // Set status to published
    let result = await UPDATE('PoetrySlamManager.PoetrySlams')
      .set({ status_code: poetrySlam.status_code })
      .where({ ID: id });

    // Handle error update result
    if (result !== 1) {
      // Error message: could not be published
      req.error(500, 'ACTION_PUBLISH_NOT_POSSIBLE', [poetrySlam.number]);
      return;
    }
    req.info(200, 'ACTION_PUBLISH_SUCCESS', [poetrySlam.number]);
    return poetrySlam;
  });

  // ----------------------------------------------------------------------------
  // Implementation of entity events (entity Visits)
  // ----------------------------------------------------------------------------

  // Check if visit is allowed to be created
  srv.before('CREATE', ['Visits.drafts', 'Visits'], async (req) => {
    // Check that a visit is allowed to be created due to status of the poetry slam
    // Errors are thrown inside the method
    await checkPoetrySlamForVisitCreation(req.data.parent_ID, req);
  });

  srv.after('UPDATE', ['Visits.drafts', 'Visits'], async (data, req) => {
    if (!req.data.visitor_ID) {
      return;
    }

    const visit = await SELECT.one.from(req.subject).columns('ID', 'parent_ID');

    if (!visit) {
      // Error message: update not possible
      req.error(500, 'UPDATE_VISIT_NOT_POSSIBLE', [req.data.ID]);
      return;
    }

    // Update the free visitor seats and the status of the poetry slam
    const changedData = await calculatePoetrySlamData(visit.parent_ID, req);
    // Update parent via transaction
    const tableExtension = req.target.name.endsWith('drafts') ? '.drafts' : '';
    const result = await UPDATE(
      `PoetrySlamManager.PoetrySlams${tableExtension}`
    )
      .set({
        status_code: changedData.status_code,
        freeVisitorSeats: changedData.freeVisitorSeats
      })
      .where({ ID: visit.parent_ID });

    if (result !== 1) {
      // Error message: update not possible
      req.error(500, 'UPDATE_VISIT_NOT_POSSIBLE', [req.data.ID]);
    }
  });

  // Initialize status of visit and update poetry slam
  srv.on('UPDATE', ['Visits.drafts', 'Visits'], async (req, next) => {
    // In case visitor is updated, default status of visit
    if (!req.data.visitor_ID) {
      return;
    }
    req.data.status_code = codes.visitStatusCode.booked;

    return next();
  });

  // Updates the poetry slam status and freevistor seats in case of deletion of a visit
  // When a draft is discarded, the CANCEL event is triggered; for Delete visit of a draft, the ID is not given, therefore this logic is required
  srv.before('CANCEL', 'Visits.drafts', async (req) => {
    await deleteVisit(req.data.ID, req);
  });

  // Updates the poetry slam status and freevistor seats in case of deletion of a visit
  srv.before('DELETE', 'Visits', async (req) => {
    await deleteVisit(req.data.ID, req);
  });

  // Apply a colour code based on the visit status
  srv.after('READ', ['Visits.drafts', 'Visits'], (data) => {
    const asArray = (x) => (Array.isArray(x) ? x : [x]);
    for (const visits of asArray(data)) {
      const status = visits.status?.code || visits.status_code;
      // Set status colour code
      switch (status) {
        case codes.visitStatusCode.booked:
          visits.statusCriticality = codes.color.green; // Booked visits are green
          break;
        case codes.visitStatusCode.canceled:
          visits.statusCriticality = codes.color.red; // canceled visits are yellow
          break;
        default:
          // In case the status is defined, but not filled, return statusCriticality with null, otherwise UI will break
          if (status === null) {
            visits.statusCriticality = null;
          }
      }
    }
  });

  // ----------------------------------------------------------------------------
  // Implementation of entity actions (entity Visits)
  // ----------------------------------------------------------------------------

  // Entity action "cancelVisit": Set the status of the visit to canceled
  // Actions are not mass enabled in service, only on UI; they are handled in a batch mode;
  srv.on('cancelVisit', async (req) => {
    // In case, the visit is called via composition of poetryslam, there are two entries, the last is the association where the action was executed
    const visit = await SELECT.one
      .from(req.subject)
      .columns('ID', 'status_code', 'parent_ID', 'visitor_ID');

    // If visits was not found, throw an error
    if (!visit) {
      const id = req.params[req.params.length - 1]?.ID;
      req.error(400, 'VISIT_NOT_FOUND', [id]);
      return;
    }

    // Determine the visitorname for the success and error messages
    const vistitorName = await readVisitorName(visit.visitor_ID);

    if (visit.status_code === codes.visitStatusCode.canceled) {
      req.info(200, 'ACTION_CANCELLED_ALREADY', [vistitorName]);
      return visit;
    }

    // Change the status of the visit
    visit.status_code = codes.visitStatusCode.canceled;

    // Update the free visitor seats and the status of the poetry slam
    const changedData = await calculatePoetrySlamData(visit.parent_ID, req, -1);

    const tableExtension = req.target.name.endsWith('drafts') ? '.drafts' : '';
    let result = await UPDATE(`PoetrySlamManager.PoetrySlams${tableExtension}`)
      .set({
        status_code: changedData.status_code,
        freeVisitorSeats: changedData.freeVisitorSeats
      })
      .where({ ID: visit.parent_ID });

    // Handle error case of update result
    if (result !== 1) {
      // Error message: could not be canceled
      req.error(500, 'ACTION_VISIT_CANCEL_NOT_POSSIBLE', [vistitorName]);
      return;
    }
    // Update visits
    result = await UPDATE(req.subject).set({
      status_code: visit.status_code
    });

    // Handle error case of update result
    if (result !== 1) {
      // Error message: could not be canceled
      req.error(500, 'ACTION_VISIT_CANCEL_NOT_POSSIBLE', [vistitorName]);
      return;
    }
    req.info(200, 'ACTION_VISIT_CANCEL_SUCCESS', [vistitorName]);

    return visit; // Return the changed visit
  });

  // Entity action "confirmVisit": Set the status of visit to confirmed
  // Actions are not mass enabled in service, only on UI; they are handled in a batch mode;
  srv.on('confirmVisit', async (req) => {
    const tableExtension = req.target.name.endsWith('drafts') ? '.drafts' : '';
    // In case, the visit is called via composition of poetryslam, there are two entries, the last is the association where the action was executed
    const visit = await SELECT.one
      .from(req.subject)
      .columns('ID', 'status_code', 'parent_ID', 'visitor_ID');

    // If visit was not found, throw an error
    if (!visit) {
      const id = req.params[req.params.length - 1]?.ID;
      req.error(400, 'VISITS_NOT_FOUND', [id]);
      return;
    }

    const vistitorName = await readVisitorName(visit.visitor_ID);

    if (visit.status_code === codes.visitStatusCode.booked) {
      req.info(200, 'ACTION_BOOKED_ALREADY', [vistitorName]);
      return visit;
    }

    //In case event gets overbooked do not allow visit confirmation
    const allowed = await checkPoetrySlamForVisitCreation(visit.parent_ID, req);
    if (!allowed) {
      return;
    }
    visit.status_code = codes.visitStatusCode.booked;

    // Update the free visitor seats and the status of the poetry slam
    const changedData = await calculatePoetrySlamData(visit.parent_ID, req, 1);

    let result = await UPDATE(`PoetrySlamManager.PoetrySlams${tableExtension}`)
      .set({
        status_code: changedData.status_code,
        freeVisitorSeats: changedData.freeVisitorSeats
      })
      .where({ ID: visit.parent_ID });

    // Handle error case of update result
    if (result !== 1) {
      // Error message: could not be booked
      req.error(400, 'ACTION_VISIT_BOOK_NOT_POSSIBLE', [vistitorName]);
      return;
    }

    // Update visits
    result = await UPDATE(req.subject).set({
      status_code: visit.status_code
    });

    // Handle error case of update result
    if (result !== 1) {
      // Error message: could not be booked
      req.error(400, 'ACTION_VISIT_BOOK_NOT_POSSIBLE', [vistitorName]);
      return;
    }

    req.info(200, 'ACTION_BOOKING_SUCCESS', [vistitorName]);

    return visit;
  });

  // ----------------------------------------------------------------------------
  // Implementation of oData function
  // ----------------------------------------------------------------------------

  // Function "userInfo": Return logged-in user
  srv.on('userInfo', async () => {
    let { user } = cds.context;
    let results = {};
    results.id = user.id;
    results.locale = user.locale;
    results.roles = {};
    results.roles.identified = user.is('identified-user');
    results.roles.authenticated = user.is('authenticated-user');
    return results;
  });

  // ----------------------------------------------------------------------------
  // Implementation of reuse functions
  // ----------------------------------------------------------------------------

  // Default the freeVisitorSeats to the maximumVisitorsNumber
  async function calculatePoetrySlamData(id, req, additionalVisits = 0) {
    const tableExtension = req.target.name.endsWith('drafts') ? '.drafts' : '';
    const changedData = {};
    if (!id) {
      req.error(500, 'POETRYSLAM_NOT_FOUND', [id]);
      return;
    }

    // Target.name of the request includes the originally changed entitiy. In case it is the draft, check in the draft table.
    const poetrySlam = await SELECT.one
      .from(`PoetrySlamManager.PoetrySlams${tableExtension}`)
      .columns('status_code', 'number', 'maxVisitorsNumber', 'freeVisitorSeats')
      .where({ ID: id });

    // If poetry slam was not found, throw an error
    if (!poetrySlam) {
      req.error(500, 'POETRYSLAM_NOT_FOUND', [id]);
      return;
    }

    let visitConfirmedCount = 0;
    if (req.data?.visits?.length) {
      req.data.visits.forEach((visit) => {
        if (visit.status_code === codes.visitStatusCode.booked) {
          visitConfirmedCount++;
        }
      });
    } else {
      //Read and calculate the confirmed visits
      let visit = await SELECT.one
        .from(`PoetrySlamManager.Visits${tableExtension}`)
        .columns('parent_ID', 'count(*) as visitConfirmedCount')
        .where({ parent_ID: id, status_code: codes.visitStatusCode.booked })
        .groupBy('parent_ID');

      visitConfirmedCount =
        visit && visit.visitConfirmedCount ? visit.visitConfirmedCount : 0;
    }
    visitConfirmedCount = visitConfirmedCount + additionalVisits;

    // In case maxVisitorsNumber was changed, use the changed
    const maxVisitorsNumber =
      req.data?.maxVisitorsNumber || poetrySlam.maxVisitorsNumber;
    // Calculate the free seats
    changedData.freeVisitorSeats =
      maxVisitorsNumber - visitConfirmedCount < 0
        ? 0
        : maxVisitorsNumber - visitConfirmedCount;

    // Calculation is required for update case
    // Set the status of reading event to booked, if there are no free seats and status is published
    changedData.status_code = calculatePoetrySlamStatus(
      poetrySlam.status_code,
      changedData.freeVisitorSeats
    );
    return changedData;
  }

  // Calculate the status in cases of changes
  function calculatePoetrySlamStatus(currentStatus, freeVisitorSeats) {
    if (
      freeVisitorSeats <= 0 &&
      currentStatus === codes.poetrySlamStatusCode.published
    ) {
      return codes.poetrySlamStatusCode.booked;
    } else if (
      freeVisitorSeats > 0 &&
      currentStatus === codes.poetrySlamStatusCode.booked
    ) {
      // Check if there are free seats and status was booked, then change the status to published
      return codes.poetrySlamStatusCode.published;
    }
    return currentStatus;
  }

  // Enable creation of visits only for published poetry slams
  async function checkPoetrySlamForVisitCreation(poetrySlamID, req) {
    if (!poetrySlamID) {
      req.error(500, 'POETRYSLAM_NOT_FOUND', [poetrySlamID]);
      return false;
    }

    let result = true;
    // Update the free visitor seats and the status of the poetry slam
    const poetrySlam = await SELECT.one
      .from(
        `PoetrySlamManager.PoetrySlams${
          req.target.name.endsWith('drafts') ? '.drafts' : ''
        }`
      )
      .columns('status_code', 'number')
      .where({ ID: poetrySlamID });

    // Check poetry slam status
    if (!poetrySlam) {
      req.error(400, 'POETRYSLAM_NOT_FOUND', [poetrySlamID]);
      result = false;
    } else if (poetrySlam.status_code === codes.poetrySlamStatusCode.booked) {
      req.error(400, 'POETRYSLAM_FULLY_BOOKED', [poetrySlam.number]);
      result = false;
    } else if (poetrySlam.status_code === codes.poetrySlamStatusCode.canceled) {
      req.error(400, 'POETRYSLAM_CANCELLED', [poetrySlam.number]);
      result = false;
    } else if (
      poetrySlam.status_code === codes.poetrySlamStatusCode.inPreparation
    ) {
      req.error(400, 'POETRYSLAM_NOT_PUBLISHED', [poetrySlam.number]);
      result = false;
    }

    if (!result) {
      req.error(400, 'VISIT_BOOK_CREATE_NOT_POSSIBLE', [poetrySlam.number]);
    }

    return result;
  }

  // Update poetry slams on deletion of visits
  async function deleteVisit(id, req) {
    if (!id) {
      req.error(500, 'VISIT_NOT_FOUND', [id]);
      return;
    }

    const currentVisit = await SELECT.one
      .from(req.subject)
      .columns('ID', 'parent_ID', 'visitor_ID', 'status_code');

    if (!currentVisit) {
      req.error(500, 'VISIT_NOT_FOUND', [id]);
      return;
    }

    // Update the free visitor seats and the status of the poetry slam
    const changedData = await calculatePoetrySlamData(
      currentVisit.parent_ID,
      req,
      currentVisit.status_code === codes.visitStatusCode.booked ? -1 : null
    );

    const tableExtension = req.target.name.endsWith('drafts') ? '.drafts' : '';
    let result = await UPDATE(`PoetrySlamManager.PoetrySlams${tableExtension}`)
      .set({
        status_code: changedData.status_code,
        freeVisitorSeats: changedData.freeVisitorSeats
      })
      .where({ ID: currentVisit.parent_ID });

    // Handle error case of update result
    if (result !== 1) {
      // Error message: could not be deleted
      req.error(500, 'DELETION_VISIT_NOT_POSSIBLE', [
        await readVisitorName(currentVisit.visitor_ID)
      ]);
    }
  }

  // Read visitor name from visitorID
  async function readVisitorName(visitorId) {
    const visitor = await SELECT.one
      .from(`PoetrySlamManager.Visitors`)
      .columns('ID', 'name')
      .where({ ID: visitorId });

    return visitor?.name;
  }
});
