// ----------------------------------------------------------------------------
// Initialization of test
// CAP Unit Testing: https://cap.cloud.sap/docs/node.js/cds-test?q=cds.test#run
// ----------------------------------------------------------------------------
'strict';

// Adds cds module
const cds = require('@sap/cds');
// Defines required CDS functions for testing
const { expect, GET, POST, axios, test } = cds.test(__dirname + '/../..');

// ----------------------------------------------------------------------------
// Tests authorizations for authorized user without role assignment for application
// Authorizations of PoetrySlamManager Service with User Peter are tested in poetrySlamManagerService.test.js
// ----------------------------------------------------------------------------

describe('Authorizations of PoetrySlamManager Service with User Denise (authenticated user only)', () => {
  before(async () => {
    // Authentication for tests
    axios.defaults.auth = { username: 'denise', password: 'welcome' };
  });

  beforeEach(async () => {
    await test.data.reset();
  });

  it('should reject the reading of the poetry slams', async () => {
    // Read all poetry slams; shall be rejected
    return expect(
      GET(`/odata/v4/poetryslammanager/PoetrySlams`, {
        params: { $select: `ID,status_code,statusCriticality` }
      })
    ).to.rejected;
  });

  it('should reject the creation of a poetry slam', async () => {
    const poetrySlamToBeCreated = {
      number: 12,
      title: 'Poetry Slam 12',
      description: 'Description Poetry Slam 12',
      dateTime: new Date(),
      maxVisitorsNumber: 20,
      visitorsFeeAmount: 9.95,
      visitorsFeeCurrency_code: 'EUR'
    };

    // Create a new poetry slam; shall be rejected
    return expect(
      POST(`/odata/v4/poetryslammanager/PoetrySlams`, poetrySlamToBeCreated)
    ).to.rejected;
  });

  it('should reject the reading of visitors', async () => {
    // Read all poetry slams; shall be rejected
    return expect(
      GET(`/odata/v4/poetryslammanager/Visitors`, {
        params: { $select: `ID,name` }
      })
    ).to.rejected;
  });

  it('should reject the creation of a visitor', async () => {
    const entryToBeCreated = {
      name: 'Max Mustermann',
      email: 'max@mustermann.de'
    };

    // Create a new poetry slam; shall be rejected
    return expect(
      POST(`/odata/v4/poetryslammanager/Visitors`, entryToBeCreated)
    ).to.rejected;
  });

  it('should reject the reading of visits', async () => {
    // Read all poetry slams; shall be rejected
    return expect(
      GET(`/odata/v4/poetryslammanager/Visits`, {
        params: { $select: `ID,artists` }
      })
    ).to.rejected;
  });

  it('should reject the creation of a visits', async () => {
    const entryToBeCreated = {
      poetrySlam_ID: '79ceab87-300d-4b66-8cc3-f82c679b77a8',
      visitor_ID: '79ceab87-300d-4b66-8cc3-c82c679b7c12'
    };

    // Create a new poetry slam; shall be rejected
    return expect(POST(`/odata/v4/poetryslammanager/Visits`, entryToBeCreated))
      .to.rejected;
  });
});

// ----------------------------------------------------------------------------
// Tests authorizations for authorized user with role assignment PoetrySlamVisitor
// ----------------------------------------------------------------------------

describe('Authorizations of PoetrySlamManager Service with User Julie (role PoetrySlamVisitor)', () => {
  before(async () => {
    // Authentication for tests
    axios.defaults.auth = { username: 'julie', password: 'welcome' };
  });

  beforeEach(test.data.reset);

  it('should return data of poetry slams in status booked and published', async () => {
    const poetrySlams = await GET(`/odata/v4/poetryslammanager/PoetrySlams`, {
      params: { $select: `ID,status_code` }
    });

    expect(poetrySlams.status).to.eql(200);
    // Read all poetry slams; shall be possible
    expect(poetrySlams.data.value.length).to.greaterThan(0);

    expect(
      poetrySlams.data.value.filter(
        (poetrySlam) => poetrySlam.status_code === 1
      ).length
    ).to.eql(0);
    expect(
      poetrySlams.data.value.filter(
        (poetrySlam) => poetrySlam.status_code === 4
      ).length
    ).to.eql(0);
  });

  it('should reject the creation of a poetry slam', async () => {
    const poetrySlamToBeCreated = {
      number: 12,
      title: 'Poetry Slam 12',
      description: 'Description Poetry Slam 12',
      dateTime: new Date(),
      maxVisitorsNumber: 20,
      visitorsFeeAmount: 9.95,
      visitorsFeeCurrency_code: 'EUR'
    };

    // Create a new poetry slam; shall be rejected
    return expect(
      POST(`/odata/v4/poetryslammanager/PoetrySlams`, poetrySlamToBeCreated)
    ).to.rejected;
  });

  it('should allow the reading of visitors', async () => {
    const visitors = await GET(`/odata/v4/poetryslammanager/Visitors`, {
      params: { $select: `ID,name` }
    });

    expect(visitors.status).to.eql(200);
    // Read all visitors; allowed but none were created by Julie
    expect(visitors.data.value.length).to.eql(0);
  });

  it('should reject the creation of a visitor', async () => {
    const entryToBeCreated = {
      name: 'Julie',
      email: 'julie@pra.ondemand.com'
    };

    return expect(
      POST(`/odata/v4/poetryslammanager/Visitors`, entryToBeCreated)
    ).to.rejected;
  });

  it('should allow reading of visits', async () => {
    const visits = await GET(`/odata/v4/poetryslammanager/Visits`, {
      params: { $select: `ID,artistIndicator` }
    });

    // Read all visits; Julie is allowed to read all visits of artists
    expect(
      visits.data.value.find(
        (poetrySlam) => poetrySlam.artistIndicator === false
      )
    ).to.undefined;

    expect(
      visits.data.value.filter(
        (poetrySlam) => poetrySlam.artistIndicator === true
      ).length
    ).to.greaterThan(0);
  });

  it('should reject the creation of a visit', async () => {
    const entryToBeCreated = {
      poetrySlam_ID: '79ceab87-300d-4b66-8cc3-f82c679b77a8',
      visitor_ID: '79ceab87-300d-4b66-8cc3-c82c679b7c12'
    };

    return expect(POST(`/odata/v4/poetryslammanager/Visits`, entryToBeCreated))
      .to.rejected;
  });
});
